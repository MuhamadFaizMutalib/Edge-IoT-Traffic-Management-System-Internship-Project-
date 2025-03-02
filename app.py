from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, Response
from werkzeug.security import generate_password_hash, check_password_hash
import cv2
import threading
import json
from flask import jsonify
import paramiko
import configparser
import psycopg2
from io import StringIO
from flask import session
from flask import abort
from flask import jsonify, request
import time
import subprocess
import os
import signal
from datetime import datetime
import netifaces
import re
from datetime import datetime, timezone, timedelta 
import subprocess
import socket
from werkzeug.utils import secure_filename



# PostgreSQL configuration
DATABASE_CONFIG = {
    'host': 'localhost',
    'user': 'dyna_user',
    'password': 'Dyna1234',
    'dbname': 'dyna',
    'port': '5432'
}

def get_db_connection():
    return psycopg2.connect(
        host=DATABASE_CONFIG['host'],
        database=DATABASE_CONFIG['dbname'],
        user=DATABASE_CONFIG['user'],
        password=DATABASE_CONFIG['password'],
        port=DATABASE_CONFIG['port']
    )



def get_terminal_ip():
    """Extract the non-localhost IP from terminal output"""
    import socket
    def get_ip():
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('10.255.255.255', 1))
            IP = s.getsockname()[0]
        except Exception:
            IP = '127.0.0.1'
        finally:
            s.close()
        return IP
    
    ip = get_ip()
    return ip if not ip.startswith('127.') else None




def auto_register_admin():
    # Get the terminal IP address
    terminal_ip = get_terminal_ip()
    
    # Skip if it's localhost
    if not terminal_ip:
        print("Skipping admin IP update for localhost")
        return
        
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Check if admin user exists
        cur.execute("SELECT id, ip_address FROM users WHERE username = %s", ('admin',))
        existing_admin = cur.fetchone()
        
        if existing_admin:
            # If admin exists and IP is different, update the IP
            if existing_admin[1] != terminal_ip:
                cur.execute(
                    "UPDATE users SET ip_address = %s WHERE username = %s",
                    (terminal_ip, 'admin')
                )
                print(f"Updated admin IP from {existing_admin[1]} to {terminal_ip}")
        else:
            # If no admin exists, create one
            hashed_password = generate_password_hash('admin')
            cur.execute(
                "INSERT INTO users (ip_address, username, password) VALUES (%s, %s, %s)",
                (terminal_ip, 'admin', hashed_password)
            )
            print(f"Created new admin account with IP: {terminal_ip}")
            
        conn.commit()
        
    except Exception as e:
        print(f"Error during admin IP update: {str(e)}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()



# Add this function to get server IP (put it before SSH Configuration Constants)
def get_server_ip():
    import socket
    def get_ip():
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # Doesn't need to be reachable, just used to get the correct local IP
            s.connect(('10.255.255.255', 1))
            IP = s.getsockname()[0]
        except Exception:
            IP = '127.0.0.1'
        finally:
            s.close()
        return IP
    return get_ip()



def reassign_stream_numbers():
    """Reassign stream IDs to ensure they are sequential"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Start a transaction
        cur.execute("BEGIN")
        
        # Get all streams ordered by creation time
        cur.execute("""
            SELECT id 
            FROM streams 
            ORDER BY created_at
        """)
        streams = cur.fetchall()
        
        # Create a temporary sequence number
        temp_column = "temp_" + str(int(time.time()))
        cur.execute(f"ALTER TABLE streams ADD COLUMN {temp_column} INTEGER")
        
        # Assign new sequential IDs
        for new_id, (old_id,) in enumerate(streams, 1):
            cur.execute(f"""
                UPDATE streams 
                SET {temp_column} = %s 
                WHERE id = %s
            """, (new_id, old_id))
            
        # Update the actual ID column
        cur.execute(f"""
            UPDATE streams 
            SET id = {temp_column}
        """)
        
        # Remove temporary column
        cur.execute(f"ALTER TABLE streams DROP COLUMN {temp_column}")
        
        # Reset the sequence
        cur.execute("""
            SELECT setval('streams_id_seq', 
                         (SELECT CASE 
                             WHEN EXISTS (SELECT 1 FROM streams) THEN MAX(id) 
                             ELSE 0 
                          END FROM streams), 
                         true)
        """)
        
        # Commit the transaction
        cur.execute("COMMIT")
        
    except Exception as e:
        cur.execute("ROLLBACK")
        print(f"Error in reassign_stream_numbers: {str(e)}")
        raise e
    finally:
        cur.close()
        conn.close()





def delete_analytics_configs(stream_id, stream_number):
    """
    Delete analytics configurations for a specific stream
    """
    try:
        # Read existing analytics configuration
        content = ssh_handler.read_remote_file(REMOTE_CONFIG_ANALYTICS)
        if content is None:
            return False

        config = configparser.ConfigParser(allow_no_value=True, delimiters=('='))
        config.optionxform = str  # Preserve case
        config.read_string(content)

        # Remove related sections
        roi_section = f'roi-filtering-stream-{stream_number}'
        line_section = f'line-crossing-stream-{stream_number}'
        
        if config.has_section(roi_section):
            config.remove_section(roi_section)
        if config.has_section(line_section):
            config.remove_section(line_section)

        # Write back to file
        output = StringIO()
        config.write(output, space_around_delimiters=False)
        return ssh_handler.write_remote_file(REMOTE_CONFIG_ANALYTICS, output.getvalue())

    except Exception as e:
        print(f"Error deleting analytics configurations: {str(e)}")
        return False



def update_analytics_configs():
    """
    Update analytics configurations while properly preserving line names during stream reindexing
    """
    try:
        # Read existing analytics configuration
        content = ssh_handler.read_remote_file(REMOTE_CONFIG_ANALYTICS)
        if content is None:
            return False

        # Parse existing configuration
        config = configparser.ConfigParser(allow_no_value=True, delimiters=('='))
        config.optionxform = str  # Preserve case
        config.read_string(content)

        # Store preserved sections
        preserved_sections = {}
        for section in config.sections():
            if not (section.startswith('roi-filtering-stream-') or 
                   section.startswith('line-crossing-stream-')):
                preserved_sections[section] = dict(config.items(section))

        # Get current streams from database
        conn = get_db_connection()
        cur = conn.cursor()
        
        try:
            # First get all streams
            cur.execute("SELECT id FROM streams ORDER BY id")
            streams = cur.fetchall()
            
            # Remove stream-related sections
            for section in list(config.sections()):
                if (section.startswith('roi-filtering-stream-') or 
                    section.startswith('line-crossing-stream-')):
                    config.remove_section(section)

            # Restore preserved sections
            for section, options in preserved_sections.items():
                if not config.has_section(section):
                    config.add_section(section)
                for option, value in options.items():
                    config.set(section, option, value if value is not None else '')

            # Process each stream
            for stream in streams:
                stream_id = stream[0]
                stream_number = stream_id - 1

                # Get virtual loop configurations
                cur.execute("""
                    SELECT roi_number, x1y1_x, x1y1_y, x2y2_x, x2y2_y, 
                           x3y3_x, x3y3_y, x4y4_x, x4y4_y
                    FROM virtual_loop_configs 
                    WHERE stream_id = %s 
                    ORDER BY roi_number
                """, (stream_id,))
                virtual_loops = cur.fetchall()

                # Get line crossing configurations with names, preserving custom names
                cur.execute("""
                    SELECT line_number, COALESCE(name, 'Line_Name_' || line_number::text) as name, 
                           start_x, start_y, end_x, end_y
                    FROM line_crossing_configs 
                    WHERE stream_id = %s 
                    ORDER BY line_number
                """, (stream_id,))
                line_crossings = cur.fetchall()

                # Add virtual loop section if configurations exist
                if virtual_loops:
                    section = f'roi-filtering-stream-{stream_number}'
                    config.add_section(section)
                    config.set(section, 'enable', '1')
                    config.set(section, 'inverse-roi', '0')
                    config.set(section, 'class-id', '-1')
                    
                    for loop in virtual_loops:
                        coords = []
                        coord_order = [(4, 7, 8), (1, 1, 2), (2, 3, 4), (3, 5, 6)]
                        for i, x_idx, y_idx in coord_order:
                            x = int(loop[x_idx] * 1280)
                            y = int(loop[y_idx] * 720)
                            coords.extend([str(x), str(y)])
                        config.set(section, f'roi-RF-{loop[0]}', ';'.join(coords))

                # Add line crossing section if configurations exist
                if line_crossings:
                    section = f'line-crossing-stream-{stream_number}-class-0'
                    config.add_section(section)
                    config.set(section, 'enable', '1')
                    config.set(section, 'class-id', '-1')
                    config.set(section, 'extended', '0')
                    config.set(section, 'mode', 'loose')
                    
                    for line in line_crossings:
                        # Get the custom name or default name
                        custom_name = line[1]  # Using COALESCE result from SQL
                        # Clean the name for config file
                        clean_name = ''.join(c for c in custom_name if c.isalnum() or c in '_-')
                        
                        # Calculate coordinates
                        start_x = int(line[2] * 1280)
                        start_y = int(line[3] * 720)
                        end_x = int(line[4] * 1280)
                        end_y = int(line[5] * 720)
                        
                        # Calculate center and arrow points
                        mid_x = (start_x + end_x) / 2
                        mid_y = (start_y + end_y) / 2
                        arrow_length = 40
                        arrow_y1 = int(mid_y + arrow_length)
                        arrow_y2 = int(mid_y - arrow_length)
                        arrow_x = int(mid_x)
                        
                        # Generate coordinates string
                        coords = f"{arrow_x};{arrow_y2};{arrow_x};{arrow_y1};{start_x};{start_y};{end_x};{end_y}"
                        config.set(section, f'line-crossing-{clean_name}', coords)

            # Write configuration
            output = StringIO()
            config.write(output, space_around_delimiters=False)
            
            # Write to SSH file
            success = ssh_handler.write_remote_file(REMOTE_CONFIG_ANALYTICS, output.getvalue())
            if not success:
                print("Failed to write analytics configurations")
                return False

            return True

        finally:
            cur.close()
            conn.close()

    except Exception as e:
        print(f"Error updating analytics configurations: {str(e)}")
        return False



def get_process_ids():
    """Get PID of deepstream process"""
    try:
        # Find deepstream process
        ds_cmd = "pgrep -f 'deepstream.*deepstream-nvdsanalytics-test'"
        ds_pid = subprocess.check_output(ds_cmd, shell=True).decode().strip()
        
        return ds_pid.split('\n')[0] if ds_pid else None
    except subprocess.CalledProcessError:
        return None


def run_command(command):
    """Run a command and return its output"""
    try:
        process = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )
        return process
    except Exception as e:
        print(f"Error running command {command}: {str(e)}")
        return None


def get_disk_info():
    try:
        # Get list of disks
        lsblk_cmd = "lsblk -d -o NAME,SIZE,MODEL,SERIAL --json"
        disks_raw = subprocess.check_output(lsblk_cmd, shell=True).decode()
        disks_data = json.loads(disks_raw)

        devices = []
        for disk in disks_data.get('blockdevices', []):
            if disk['name'].startswith(('sd', 'nvme')):
                # Get SMART data for each disk
                smartctl_cmd = f"sudo smartctl -a /dev/{disk['name']} -j"
                try:
                    smart_raw = subprocess.check_output(smartctl_cmd, shell=True).decode()
                    smart_data = json.loads(smart_raw)

                    # Extract relevant SMART information
                    device_info = {
                        'name': f"/dev/{disk['name']}",
                        'model': disk.get('model', 'Unknown'),
                        'serial': smart_data.get('serial_number', disk.get('serial', 'Unknown')),
                        'capacity': disk.get('size', 'Unknown'),
                        'temperature': smart_data.get('temperature', {}).get('current', 'N/A'),
                        'powerOnHours': smart_data.get('power_on_time', {}).get('hours', 'N/A'),
                        'health': smart_data.get('smart_status', {}).get('passed', False) and 'PASSED' or 'FAILED',
                        'attributes': []
                    }

                    # Process SMART attributes
                    if 'ata_smart_attributes' in smart_data:
                        for attr in smart_data['ata_smart_attributes']['table']:
                            device_info['attributes'].append({
                                'id': attr['id'],
                                'name': attr['name'],
                                'value': attr['value'],
                                'worst': attr['worst'],
                                'threshold': attr['thresh'],
                                'status': 'OK' if attr['value'] > attr['thresh'] else 'FAIL'
                            })

                    devices.append(device_info)
                except subprocess.CalledProcessError as e:
                    print(f"Error getting SMART data for {disk['name']}: {str(e)}")
                except json.JSONDecodeError as e:
                    print(f"Error parsing SMART data for {disk['name']}: {str(e)}")

        # Get disk usage information
        disk_usage = get_disk_usage()
        return {
            'devices': devices,
            'diskUsage': disk_usage
        }
    except Exception as e:
        print(f"Error in get_disk_info: {str(e)}")
        return {
            'devices': [], 
            'diskUsage': [],
            'error': str(e)
        }

def get_disk_usage():
    try:
        df_cmd = "df -h"
        output = subprocess.check_output(df_cmd, shell=True).decode()
        disks = []
        
        for line in output.split('\n')[1:]:  # Skip header
            if line:
                parts = line.split()
                if len(parts) >= 6:  # Ensure we have all required fields
                    filesystem = parts[0]
                    size = parts[1]
                    used = parts[2]
                    avail = parts[3]
                    use_percent = parts[4]
                    mount_point = parts[5]
                    
                    # Only include root partition
                    if mount_point == '/':
                        disks.append({
                            'mountPoint': mount_point,
                            'filesystem': filesystem,
                            'size': size,
                            'used': used,
                            'available': avail,
                            'usePercentage': use_percent
                        })
        
        return disks
    except Exception as e:
        print(f"Error getting disk usage: {str(e)}")
        return []



def check_internet_connection():
    """Test internet connectivity and measure delay"""
    try:
        # Try to ping Google's DNS server
        cmd = ['ping', '-c', '1', '8.8.8.8']
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT, universal_newlines=True)
        
        # Extract ping time using regex
        match = re.search(r'time=(\d+\.?\d*)', output)
        delay = match.group(1) if match else 'N/A'
        
        return {
            'access': True,
            'delay': f"{delay} ms"
        }
    except subprocess.CalledProcessError:
        return {
            'access': False,
            'delay': 'N/A'
        }


def check_dns_access():
    """Test DNS resolution"""
    try:
        socket.gethostbyname('google.com')
        return True
    except socket.gaierror:
        return False

def check_vpn_status():
    """Check VPN interfaces and connections"""
    try:
        # Check for VPN interfaces
        cmd = "ip a | grep tun"
        vpn_interfaces = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL)
        local_vpn = bool(vpn_interfaces)
    except subprocess.CalledProcessError:
        local_vpn = False

    try:
        # Check OpenVPN status (modify based on your VPN service)
        cmd = "systemctl is-active openvpn"
        status = subprocess.check_output(cmd, shell=True).decode().strip()
        server_vpn = status == 'active'
    except subprocess.CalledProcessError:
        server_vpn = False

    return local_vpn, server_vpn

def check_vpn_port():
    """Check if VPN port is open (default OpenVPN port)"""
    try:
        cmd = "ss -tuln | grep ':1194'"
        output = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL)
        return bool(output)
    except subprocess.CalledProcessError:
        return False

def get_network_interfaces():
    """Get network interface statistics"""
    interfaces = []
    try:
        # Get interface statistics
        with open('/proc/net/dev') as f:
            lines = f.readlines()[2:]  # Skip headers
            
        for line in lines:
            interface = {}
            parts = line.split(':')
            if len(parts) < 2:
                continue
                
            interface['name'] = parts[0].strip()
            stats = parts[1].split()
            
            # Skip loopback interface
            if interface['name'] == 'lo':
                continue
                
            # Get IP address
            try:
                cmd = f"ip addr show {interface['name']} | grep 'inet ' | awk '{{print $2}}'"
                ip = subprocess.check_output(cmd, shell=True).decode().strip()
                interface['ipAddress'] = ip
            except subprocess.CalledProcessError:
                interface['ipAddress'] = 'N/A'
            
            # Convert bytes to human-readable format
            def bytes_to_human(bytes_value):
                for unit in ['B', 'KB', 'MB', 'GB']:
                    if bytes_value < 1024:
                        return f"{bytes_value:.2f} {unit}"
                    bytes_value /= 1024
                return f"{bytes_value:.2f} TB"
            
            # Calculate rates (bytes per second)
            interface['receive'] = bytes_to_human(float(stats[0]))
            interface['totalReceived'] = bytes_to_human(float(stats[0]))
            interface['transmit'] = bytes_to_human(float(stats[8]))
            interface['totalTransmitted'] = bytes_to_human(float(stats[8]))
            
            interfaces.append(interface)
            
        return interfaces
    except Exception as e:
        print(f"Error getting network interfaces: {str(e)}")
        return []



def get_swap_info():
    try:
        with open('/proc/meminfo', 'r') as f:
            lines = f.readlines()
            swap_info = {}
            for line in lines:
                if 'SwapTotal' in line:
                    swap_info['total'] = int(line.split()[1]) // 1024  # Convert to MB
                elif 'SwapFree' in line:
                    swap_free = int(line.split()[1]) // 1024  # Convert to MB
                    swap_info['used'] = swap_info.get('total', 0) - swap_free
            
            # Convert to human-readable format
            if swap_info:
                return {
                    'swapUsed': f"{swap_info['used'] / 1024:.2f} GB",
                    'swapTotal': f"{swap_info['total'] / 1024:.2f} GB"
                }
    except Exception as e:
        print(f"Error getting swap info: {str(e)}")
    return {'swapUsed': '-', 'swapTotal': '-'}




def execute_recovery_action(action_type):
    """Execute the specified recovery action"""
    try:
        if action_type == 'reboot-node':
            subprocess.run(['sudo', 'reboot', 'now'])
        elif action_type == 'reboot-block':
            # Implement block-specific reboot
            subprocess.run(['sudo', 'systemctl', 'restart', 'deepstream'])
            subprocess.run(['sudo', 'systemctl', 'restart', 'stream'])
            # subprocess.run(['sudo', 'systemctl', 'restart', 'DynaApp'])
        elif action_type == 'reboot-both':
            subprocess.run(['sudo', 'systemctl', 'restart', 'deepstream'])
            subprocess.run(['sudo', 'systemctl', 'restart', 'stream'])
            subprocess.run(['sudo', 'systemctl', 'restart', 'DynaApp'])
            subprocess.run(['sudo', 'reboot', 'now'])
        elif action_type == 'hw-reset':
            # Implement hardware reset - this might require specific hardware commands
            subprocess.run(['sudo', 'systemctl', 'restart', 'deepstream'])
            subprocess.run(['sudo', 'systemctl', 'restart', 'stream'])
            subprocess.run(['sudo', 'systemctl', 'restart', 'DynaApp'])
            subprocess.run(['sudo', 'reboot', '-f', 'now'])
            
    except Exception as e:
        print(f"Error executing recovery action: {str(e)}")
        return False
    return True



def check_auto_recover_actions():
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Get all enabled auto-recover settings
        cur.execute("""
            SELECT id, user_id, interval_days, interval_hours, interval_minutes,
                   start_time, action_type, last_executed
            FROM auto_recover_settings 
            WHERE enabled = true
        """)
        
        settings = cur.fetchall()
        current_time = datetime.now(timezone.utc)
        
        for setting in settings:
            setting_id, user_id, days, hours, minutes, start_time, action_type, last_executed = setting
            
            # Calculate total interval in seconds
            interval_seconds = (days * 86400) + (hours * 3600) + (minutes * 60)
            
            # Calculate next execution time
            if last_executed is None:
                next_execution = start_time.replace(tzinfo=timezone.utc)
            else:
                next_execution = last_executed + timedelta(seconds=interval_seconds)
            
            if current_time >= next_execution:
                print(f"Executing auto-recover action {action_type} for setting {setting_id}")
                success = execute_recovery_action(action_type)
                
                if success:
                    cur.execute("""
                        UPDATE auto_recover_settings 
                        SET last_executed = %s 
                        WHERE id = %s
                    """, (current_time, setting_id))
                    conn.commit()
                    
    except Exception as e:
        print(f"Error in check_auto_recover_actions: {str(e)}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()


def auto_recover_thread():
    """Thread function to periodically check and execute auto-recover actions"""
    while True:
        try:
            check_auto_recover_actions()
            # Sleep for a shorter interval to improve timing accuracy
            time.sleep(0.2)  # Check every second instead of every minute
        except Exception as e:
            print(f"Error in auto recover thread: {str(e)}")



def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS



def get_certificate_info(cert_path):
    """Read certificate information using OpenSSL"""
    try:
        # Use OpenSSL to get certificate information
        cmd = f"openssl x509 -in {cert_path} -text -noout"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        
        if result.returncode != 0:
            raise Exception(f"Failed to read certificate: {result.stderr}")
            
        cert_text = result.stdout
        
        # Parse the certificate information
        info = {
            'issuer': '',
            'subject': '',
            'effective_timestamp': '',
            'expiry_timestamp': '',
            'version': '',
            'is_self_signed': False
        }
        
        # Extract issuer
        for line in cert_text.split('\n'):
            if 'Issuer:' in line:
                info['issuer'] = line.split('Issuer:')[1].strip()
            elif 'Subject:' in line:
                info['subject'] = line.split('Subject:')[1].strip()
            elif 'Not Before:' in line:
                info['effective_timestamp'] = parse_cert_date(line.split('Not Before:')[1].strip())
            elif 'Not After :' in line:
                info['expiry_timestamp'] = parse_cert_date(line.split('Not After :')[1].strip())
            elif 'Version:' in line:
                info['version'] = line.split('Version:')[1].strip()
        
        # Check if self-signed (issuer equals subject)
        info['is_self_signed'] = info['issuer'] == info['subject']
        
        return info
        
    except Exception as e:
        print(f"Error reading certificate: {str(e)}")
        return None

def parse_cert_date(date_str):
    """Convert OpenSSL date format to desired format"""
    try:
        # Parse OpenSSL date format
        dt = datetime.strptime(date_str, '%b %d %H:%M:%S %Y %Z')
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except Exception as e:
        print(f"Error parsing date: {str(e)}")
        return date_str





app = Flask(__name__)
app.secret_key = 'empayer45%$&'
auto_register_admin() 


# SSH Configuration Constants
SSH_HOST = get_server_ip()
SSH_USER = 'dyna'            # Update with your SSH username
SSH_PASSWORD = 'Dyna1234'    # Update with your SSH password
REMOTE_CONFIG_ANALYTICS = '/opt/nvidia/deepstream/deepstream-7.0/sources/apps/sample_apps/deepstream-nvdsanalytics-test/config_nvdsanalytics.txt'
REMOTE_CONFIG_APP = '/opt/nvidia/deepstream/deepstream-7.0/sources/apps/sample_apps/deepstream-nvdsanalytics-test/deepstream_app_config.txt'
REMOTE_CONFIG_META = '/opt/nvidia/deepstream/deepstream-7.0/sources/apps/sample_apps/deepstream-nvdsanalytics-test/deepstream_nvdsanalytics_meta.cpp'
SSL_UPLOAD_FOLDER = '/opt/nvidia/deepstream/deepstream-7.0/sources/apps/sample_apps/deepstream-nvdsanalytics-test/SSL'
ALLOWED_EXTENSIONS = {'crt', 'key', 'pem'}

# Modified SSH Handler class with better error handling
class SSHHandler:
    def __init__(self, host=None, username=SSH_USER, password=SSH_PASSWORD):
        self.host = host or get_server_ip()  # Use provided host or get current IP
        self.username = username
        self.password = password
        self.client = None
        self.connected = False

    def connect(self):
        try:
            if self.connected and self.client:
                return True
                
            self.client = paramiko.SSHClient()
            self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            self.client.connect(
                self.host, 
                username=self.username, 
                password=self.password,
                timeout=10
            )
            self.connected = True
            print(f"Successfully connected to {self.host}")
            return True
        except paramiko.AuthenticationException:
            print(f"Authentication failed for {self.host}")
            return False
        except paramiko.SSHException as ssh_exception:
            print(f"SSH exception occurred: {str(ssh_exception)}")
            return False
        except Exception as e:
            print(f"Failed to connect to {self.host}: {str(e)}")
            return False

    def disconnect(self):
        if self.client:
            self.client.close()
            self.client = None
            self.connected = False

    def read_remote_file(self, remote_path):
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                if not self.client or not self.connected:
                    if not self.connect():
                        return None
                        
                sftp = self.client.open_sftp()
                with sftp.file(remote_path, 'r') as remote_file:
                    content = remote_file.read()
                sftp.close()
                return content.decode('utf-8') if isinstance(content, bytes) else content
            except IOError as io_error:
                print(f"IO Error reading remote file: {str(io_error)}")
                retry_count += 1
                if retry_count < max_retries:
                    print(f"Retrying... Attempt {retry_count + 1} of {max_retries}")
                    time.sleep(1)
            except Exception as e:
                print(f"Error reading remote file {remote_path}: {str(e)}")
                return None
            
        return None

    def write_remote_file(self, remote_path, content):
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                if not self.client or not self.connected:
                    if not self.connect():
                        return False
                        
                sftp = self.client.open_sftp()
                with sftp.file(remote_path, 'w') as remote_file:
                    remote_file.write(content)
                sftp.close()
                return True
            except IOError as io_error:
                print(f"IO Error writing to remote file: {str(io_error)}")
                retry_count += 1
                if retry_count < max_retries:
                    print(f"Retrying... Attempt {retry_count + 1} of {max_retries}")
                    time.sleep(1)
            except Exception as e:
                print(f"Error writing to remote file {remote_path}: {str(e)}")
                return False
            
        return False

# Initialize SSH handler
ssh_handler = SSHHandler()

class VideoStream:
    def __init__(self):
        self.streams = {}           # Dictionary to store video captures
        self.stream_names = {}      # Dictionary to store analytics names
        self.stream_urls = {}       # Dictionary to store stream URLs
        self.locks = {}             # Dictionary to store locks for each stream
        self.last_frame = {}        # Store last valid frame
        self.target_fps = 0.5        # Lower target FPS for better stability
        self.frame_interval = 1.0 / self.target_fps

    def add_stream(self, stream_id, rtsp_url, analytics_name):
        try:
            cap = cv2.VideoCapture(f"{rtsp_url}?rtsp_transport=tcp", cv2.CAP_FFMPEG)
            
            # Set basic properties
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)  # Reduce buffer size
            cap.set(cv2.CAP_PROP_FPS, self.target_fps)
            
            if not cap.isOpened():
                return False, "Failed to open RTSP stream"

            stream_id_str = str(stream_id)
            self.streams[stream_id_str] = cap
            self.stream_names[stream_id_str] = analytics_name
            self.stream_urls[stream_id_str] = rtsp_url
            self.locks[stream_id_str] = threading.Lock()
            self.last_frame[stream_id_str] = None

            return True, stream_id_str
        except Exception as e:
            return False, str(e)
    
    def get_total_streams(self):
        return len(self.streams)

    def get_frame(self, stream_id):
        if stream_id not in self.streams:
            return None

        with self.locks[stream_id]:
            cap = self.streams[stream_id]
            success, frame = cap.read()
            
            # If read fails, try reinitialization
            if not success:
                print(f"Reinitializing stream {stream_id} due to persistent failure")
                cap.release()
                cap = cv2.VideoCapture(f"{self.stream_urls[stream_id]}?rtsp_transport=tcp")
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
                cap.set(cv2.CAP_PROP_FPS, self.target_fps)
                self.streams[stream_id] = cap
                
                success, frame = cap.read()
                if not success:
                    # If reinitialization fails, use last known good frame if available
                    if self.last_frame[stream_id] is not None:
                        frame = self.last_frame[stream_id]
                        success = True
                    else:
                        print(f"Failed to reinitialize stream {stream_id}")
                        return None

            if success:
                # Store successful frame
                self.last_frame[stream_id] = frame.copy()
                
                # Optimize frame quality
                encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 85]
                ret, buffer = cv2.imencode('.jpg', frame, encode_param)
                return buffer.tobytes()
            
            return None

    def remove_stream(self, stream_id):
        if stream_id in self.streams:
            with self.locks[stream_id]:
                self.streams[stream_id].release()
            del self.streams[stream_id]
            del self.stream_names[stream_id]
            del self.stream_urls[stream_id]
            del self.locks[stream_id]
            if stream_id in self.last_frame:
                del self.last_frame[stream_id]





# Initialize the video stream manager
video_stream = VideoStream()

def initialize_streams_from_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # First check if there are any streams in the table
        cur.execute("SELECT COUNT(*) FROM streams")
        count = cur.fetchone()[0]
        
        if count == 0:
            print("No streams found in database. Skipping initialization.")
            cur.close()
            conn.close()
            return
        
        # If there are streams, proceed with initialization
        cur.execute("SELECT id, rtsp_url, analytics_name FROM streams")
        streams = cur.fetchall()
        
        for stream_id, rtsp_url, analytics_name in streams:
            success, identifier = video_stream.add_stream(stream_id, rtsp_url, analytics_name)
            if success:
                print(f"Successfully initialized stream {identifier}")
            else:
                print(f"Failed to initialize stream {stream_id}: {identifier}")
                
    except psycopg2.Error as e:
        print(f"Database error during stream initialization: {str(e)}")
    except Exception as e:
        print(f"Unexpected error during stream initialization: {str(e)}")
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()

# Call the function to initialize streams
initialize_streams_from_db()



# Update the update_source_configs function
def update_source_configs():
    try:
        # Use REMOTE_CONFIG_APP instead of hardcoded path
        content = ssh_handler.read_remote_file(REMOTE_CONFIG_APP)
        if content is None:
            return False

        # Parse existing configuration
        config = configparser.ConfigParser(allow_no_value=True, delimiters=('='))
        config.optionxform = str  # Preserve case
        config.read_string(content)

        # Store non-source sections
        preserved_sections = {}
        for section in config.sections():
            if not section.startswith('source'):
                preserved_sections[section] = dict(config.items(section))

        # Get all streams from database
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, rtsp_url FROM streams ORDER BY id")
        streams = cur.fetchall()
        cur.close()
        conn.close()

        # Create new configuration parser
        new_config = configparser.ConfigParser(allow_no_value=True, delimiters=('='))
        new_config.optionxform = str

        # Restore preserved sections
        for section, options in preserved_sections.items():
            new_config.add_section(section)
            for option, value in options.items():
                new_config.set(section, option, value if value is not None else '')

        # Add source sections
        for stream in streams:
            stream_id = stream[0]
            rtsp_url = stream[1]
            section_name = f'source{stream_id - 1}'
            
            new_config.add_section(section_name)
            new_config.set(section_name, 'enable', '1')
            new_config.set(section_name, 'type', '4')
            new_config.set(section_name, 'uri', rtsp_url)
            new_config.set(section_name, 'num-sources', '1')
            new_config.set(section_name, 'gpu-id', '0')
            new_config.set(section_name, 'cudadec-memtype', '0')
            new_config.set(section_name, 'camera-fps-n', '8')
            new_config.set(section_name, 'camera-fps-d', '1')
            new_config.set(section_name, 'drop-frame-interval', '0')
            new_config.set(section_name, 'latency', '0')
            new_config.set(section_name, 'rtsp-reconnect-attempts', '1')
            new_config.set(section_name, 'rtsp-reconnect-interval-sec', '5')
            new_config.set(section_name, 'framerate', '8')

        # Write to string buffer
        output = StringIO()
        for section in new_config.sections():
            output.write(f'[{section}]\n')
            for key, value in new_config.items(section):
                if value is not None:
                    output.write(f'{key}={value}\n')
                else:
                    output.write(f'{key}\n')
            output.write('\n')

        # Write to SSH file using REMOTE_CONFIG_APP
        success = ssh_handler.write_remote_file(REMOTE_CONFIG_APP, output.getvalue())
        if not success:
            print("Failed to write source configurations to SSH file")
            return False
            
        return True
        
    except Exception as e:
        print(f"Error updating source configurations: {str(e)}")
        return False



@app.route('/')
def login_page():
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    ip_address = request.form.get('ip')
    username = request.form.get('username')
    password = request.form.get('password')
    
    hashed_password = generate_password_hash(password)
    
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO users (ip_address, username, password) VALUES (%s, %s, %s)",
                    (ip_address, username, hashed_password))
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        flash('Username already exists, please choose a different one.')
        return redirect(url_for('login_page'))
    finally:
        cur.close()
        conn.close()
    
    flash('Registration successful! Please log in.')
    return redirect(url_for('login_page'))


@app.route('/MyAccount/<user_id>')
def my_account(user_id):
    if 'username' not in session or session.get('user_id') != int(user_id):
        return redirect(url_for('login_page'))
    return render_template('MyAccount.html')



@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        ip_address = request.form.get('ip')

        conn = get_db_connection()
        cur = conn.cursor()
        
        # Fetch user details from the database
        cur.execute("SELECT id, password FROM users WHERE username = %s AND ip_address = %s", (username, ip_address))
        user = cur.fetchone()
        cur.close()
        conn.close()

        if user and check_password_hash(user[1], password):
            # Store username, user_id, and IP address in the session
            session['username'] = username
            session['ip_address'] = ip_address
            session['user_id'] = user[0]  # user[0] is the `id` from the database
            
            print("Session set - Username:", session.get('username'))
            print("Session set - User ID:", session.get('user_id'))
            print("Session set - IP Address:", session.get('ip_address'))

            return redirect(url_for('index_page'))
        else:
            flash('Invalid username, password, or IP address')
            return redirect(url_for('login'))

    return render_template('login.html')



@app.route('/index')
def index_page():
    if 'username' not in session:
        # Redirect to login if the user is not authenticated
        return redirect(url_for('login_page'))
    return render_template('index.html')



@app.route('/check_ip', methods=['POST'])
def check_ip():
    data = request.json
    ip_address = data.get('ip_address')
    
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT username FROM users WHERE ip_address = %s", (ip_address,))
    user = cur.fetchone()
    cur.close()
    conn.close()
    
    if user:
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'message': 'IP address not found'})




@app.route('/block_settings')
def block_settings():
    if 'username' not in session:
        return redirect(url_for('login_page'))
    return render_template('block_settings.html')


@app.route('/MyAccount')
def MyAccount():
    return render_template('MyAccount.html')
  


@app.route('/add_stream', methods=['POST'])
def add_stream():
    data = request.json
    rtsp_url = data.get('rtsp_url')
    analytics_name = data.get('analytics_name')

    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Get user ID
        cur.execute("SELECT id FROM users WHERE username = %s", (username,))
        user_id = cur.fetchone()
        if not user_id:
            return jsonify({'success': False, 'message': 'User not found'}), 404
        user_id = user_id[0]

        # Insert the stream
        cur.execute(
            "INSERT INTO streams (user_id, analytics_name, rtsp_url) VALUES (%s, %s, %s) RETURNING id",
            (user_id, analytics_name, rtsp_url)
        )
        stream_id = cur.fetchone()[0]
        conn.commit()

        # Reassign stream numbers to ensure sequential order
        reassign_stream_numbers()

        # Add the new stream to the VideoStream instance
        success, stream_identifier = video_stream.add_stream(stream_id, rtsp_url, analytics_name)
        if not success:
            return jsonify({'success': False, 'error': f'Failed to initialize stream: {stream_identifier}'})

        # Update SSH config files
        if not update_source_configs():
            return jsonify({'success': False, 'error': 'Failed to update source configurations'})

        return jsonify({
            'success': True,
            'stream_id': stream_id,
            'analytics_name': analytics_name
        })

    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)})
    finally:
        cur.close()
        conn.close()





@app.route('/video_feed/<stream_id>')
def video_feed(stream_id):
    def generate():
        while True:
            frame = video_stream.get_frame(stream_id)
            if frame is None:
                break
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
    
    return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')



@app.route('/get_stream_name/<stream_id>')
def get_stream_name(stream_id):
    name = video_stream.stream_names.get(stream_id)
    if name:
        return jsonify({'success': True, 'name': name})
    return jsonify({'success': False, 'error': 'Stream not found'})


@app.route('/stream_configuration')
def stream_configuration():
    stream_id = int(request.args.get('streamId', 0))
    stream_number = max(0, stream_id - 1)  # Ensure stream_number is not negative
    user_ip = session.get('ip_address', '127.0.0.1')  # Default to localhost if session IP is missing
    adjusted_stream_id = max(0, int(stream_id) - 1)   # Adjust stream ID to be zero-based
    stream_url = f"http://{user_ip}:8088/stream/{adjusted_stream_id}"

    return render_template(
        'StreamConfiguration.html',
        stream_id=stream_id,
        stream_number=stream_number,
        stream_url=stream_url
    )



@app.route('/get_streams')
def get_streams():
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    cur = conn.cursor()
    
    # Fetch user ID from the users table
    cur.execute("SELECT id FROM users WHERE username = %s", (username,))
    user_id = cur.fetchone()
    
    if not user_id:
        cur.close()
        conn.close()
        return jsonify({'success': False, 'message': 'User not found'}), 404

    user_id = user_id[0]
    
    # Fetch streams associated with the user
    cur.execute("SELECT id, analytics_name FROM streams WHERE user_id = %s", (user_id,))
    streams = [{'stream_id': str(row[0]), 'analytics_name': row[1]} for row in cur.fetchall()]
    
    cur.close()
    conn.close()
    
    return jsonify({'success': True, 'streams': streams})


@app.route('/save_virtual_loop', methods=['POST'])
def save_virtual_loop():
    try:
        data = request.get_json()
        stream_number = data.get('streamNumber')
        loops = data.get('loops', [])
        deleted_loops = data.get('deletedLoops', [])

        if stream_number is None:
            return jsonify({'success': False, 'message': 'Missing required parameters'})

        # Read existing configuration
        content = ssh_handler.read_remote_file(REMOTE_CONFIG_ANALYTICS)
        if content is None:
            return jsonify({'success': False, 'message': 'Failed to read remote configuration'})

        config = configparser.ConfigParser(allow_no_value=True, delimiters=('='))
        config.optionxform = str
        config.read_string(content)

        # Setup ROI section
        roi_section = f'roi-filtering-stream-{stream_number}'
        
        # Remove the section if it exists
        if config.has_section(roi_section):
            config.remove_section(roi_section)

        # Database operations
        conn = get_db_connection()
        cur = conn.cursor()

        try:
            stream_id = stream_number + 1
            
            # Start a transaction
            cur.execute("BEGIN")
            
            # Get existing configurations
            cur.execute("""
                SELECT id FROM virtual_loop_configs 
                WHERE stream_id = %s 
                ORDER BY roi_number
            """, (stream_id,))
            existing_configs = cur.fetchall()
            
            # Update or insert configurations
            if loops:
                config.add_section(roi_section)
                config.set(roi_section, 'enable', '1')

                for index, loop in enumerate(loops):
                    coordinates = loop['coordinates']
                    
                    # If we have an existing config, update it
                    if index < len(existing_configs):
                        cur.execute("""
                            UPDATE virtual_loop_configs 
                            SET x1y1_x = %s, x1y1_y = %s, 
                                x2y2_x = %s, x2y2_y = %s,
                                x3y3_x = %s, x3y3_y = %s,
                                x4y4_x = %s, x4y4_y = %s
                            WHERE id = %s
                        """, (
                            coordinates['x1y1']['x'],
                            coordinates['x1y1']['y'],
                            coordinates['x2y2']['x'],
                            coordinates['x2y2']['y'],
                            coordinates['x3y3']['x'],
                            coordinates['x3y3']['y'],
                            coordinates['x4y4']['x'],
                            coordinates['x4y4']['y'],
                            existing_configs[index][0]
                        ))
                    else:
                        # Insert new configuration if needed
                        cur.execute("""
                            INSERT INTO virtual_loop_configs 
                            (stream_id, roi_number, x1y1_x, x1y1_y, x2y2_x, x2y2_y, x3y3_x, x3y3_y, x4y4_x, x4y4_y)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            stream_id,
                            index + 1,
                            coordinates['x1y1']['x'],
                            coordinates['x1y1']['y'],
                            coordinates['x2y2']['x'],
                            coordinates['x2y2']['y'],
                            coordinates['x3y3']['x'],
                            coordinates['x3y3']['y'],
                            coordinates['x4y4']['x'],
                            coordinates['x4y4']['y']
                        ))

                    # Update SSH config
                    coord_list = []
                    for point in ['x4y4', 'x1y1', 'x2y2', 'x3y3']:
                        x = int(coordinates[point]['x'] * 1280)
                        y = int(coordinates[point]['y'] * 720)
                        coord_list.extend([str(x), str(y)])

                    coord_str = ';'.join(coord_list)
                    config.set(roi_section, f'roi-RF-{index + 1}', coord_str)

                # Add additional configuration
                config.set(roi_section, 'inverse-roi', '0')
                config.set(roi_section, 'class-id', '-1')

                # Remove any extra existing configurations
                if len(existing_configs) > len(loops):
                    extra_ids = [config[0] for config in existing_configs[len(loops):]]
                    cur.execute("""
                        DELETE FROM virtual_loop_configs 
                        WHERE id = ANY(%s)
                    """, (extra_ids,))

            else:
                # If no loops, delete all configurations for this stream
                cur.execute("DELETE FROM virtual_loop_configs WHERE stream_id = %s", (stream_id,))

            # Write SSH configuration
            output = StringIO()
            config.write(output, space_around_delimiters=False)
            success = ssh_handler.write_remote_file(REMOTE_CONFIG_ANALYTICS, output.getvalue())

            if not success:
                raise Exception('Failed to write to SSH configuration file')

            # Commit transaction
            conn.commit()
            return jsonify({'success': True})

        except Exception as e:
            cur.execute("ROLLBACK")
            raise e
        finally:
            cur.close()
            conn.close()

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/save_line_crossing', methods=['POST'])
def save_line_crossing():
    try:
        data = request.get_json()
        stream_number = data.get('streamNumber')
        line_crossings = data.get('lineCrossings', [])
        deleted_lines = data.get('deletedLines', [])

        if stream_number is None:
            return jsonify({'success': False, 'message': 'Missing required parameters'})

        # Read existing configuration
        content = ssh_handler.read_remote_file(REMOTE_CONFIG_ANALYTICS)
        if content is None:
            return jsonify({'success': False, 'message': 'Failed to read remote configuration'})

        config = configparser.ConfigParser(allow_no_value=True, delimiters=('='))
        config.optionxform = str
        config.read_string(content)

        line_section = f'line-crossing-stream-{stream_number}-class-0'
       
        # Remove the section if it exists
        if config.has_section(line_section):
            config.remove_section(line_section)

        # Database operations
        conn = get_db_connection()
        cur = conn.cursor()

        try:
            stream_id = stream_number + 1
            # Clear existing configurations
            cur.execute("DELETE FROM line_crossing_configs WHERE stream_id = %s", (stream_id,))

            # Only add new section and configurations if there are line crossings
            if line_crossings:
                config.add_section(line_section)
                config.set(line_section, 'enable', '1')

                # Add new configurations using custom names
                for idx, line in enumerate(line_crossings):
                    # Get the custom name or use default
                    custom_name = line.get('name', f'Line_Name {idx + 1}')
                    # Clean the name for use in config file (remove spaces and special characters)
                    clean_name = ''.join(c for c in custom_name if c.isalnum() or c in '_-')
                    
                    # Create config key with custom name
                    config_key = f'line-crossing-{clean_name}'
                   
                    # Save to config file
                    config.set(line_section, config_key, line['coordinates'])

                    # Parse coordinates for database storage
                    coords = line['coordinates'].split(';')
                    start_x = float(coords[4]) / 1280
                    start_y = float(coords[5]) / 720
                    end_x = float(coords[6]) / 1280
                    end_y = float(coords[7]) / 720

                    # Save to database with original name
                    cur.execute("""
                        INSERT INTO line_crossing_configs
                        (stream_id, line_number, name, start_x, start_y, end_x, end_y)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (
                        stream_id,
                        idx + 1,
                        custom_name,  # Use the original custom name in database
                        start_x,
                        start_y,
                        end_x,
                        end_y
                    ))

                # Add additional configuration
                config.set(line_section, 'class-id', '-1')
                config.set(line_section, 'extended', '0')
                config.set(line_section, 'mode', 'loose')

            # Write configuration to SSH file
            output = StringIO()
            config.write(output, space_around_delimiters=False)
            success = ssh_handler.write_remote_file(REMOTE_CONFIG_ANALYTICS, output.getvalue())

            if not success:
                raise Exception('Failed to write to SSH configuration file')

            conn.commit()
            return jsonify({'success': True})

        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cur.close()
            conn.close()

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# Update get_configurations route to include line names
@app.route('/get_configurations/<stream_id>')
def get_configurations(stream_id):
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Get virtual loop configurations
        cur.execute("""
            SELECT roi_number, x1y1_x, x1y1_y, x2y2_x, x2y2_y, x3y3_x, x3y3_y, x4y4_x, x4y4_y
            FROM virtual_loop_configs
            WHERE stream_id = %s
            ORDER BY roi_number
        """, (stream_id,))
        virtual_loops = cur.fetchall()

        # Get line crossing configurations with names
        cur.execute("""
            SELECT line_number, name, start_x, start_y, end_x, end_y
            FROM line_crossing_configs
            WHERE stream_id = %s
            ORDER BY line_number
        """, (stream_id,))
        line_crossings = cur.fetchall()

        # Format virtual loop data
        virtual_loop_data = [{
            'rfNumber': row[0],
            'coordinates': {
                'x1y1': {'x': row[1], 'y': row[2]},
                'x2y2': {'x': row[3], 'y': row[4]},
                'x3y3': {'x': row[5], 'y': row[6]},
                'x4y4': {'x': row[7], 'y': row[8]}
            },
            'isDeleted': False
        } for row in virtual_loops]

        # Format line crossing data with names
        line_crossing_data = [{
            'number': row[0],
            'name': row[1] or f'Line_Name {row[0]}',
            'start': {'x': row[2], 'y': row[3]},
            'end': {'x': row[4], 'y': row[5]},
            'isDeleted': False
        } for row in line_crossings]

        return jsonify({
            'success': True,
            'virtualLoops': virtual_loop_data,
            'lineCrossings': line_crossing_data
        })

    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()





@app.route('/user_data', methods=['GET'])
def get_user_data():
    # Check if username is available in session
    print("Checking session for username:", session.get('username'))
    username = session.get('username')
    
    if not username:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT username, ip_address FROM users WHERE username = %s", (username,))
    user = cur.fetchone()
    cur.close()
    conn.close()

    if user:
        return jsonify({'success': True, 'data': {'username': user[0], 'ip_address': user[1]}})
    else:
        return jsonify({'success': False, 'message': 'User not found'}), 404



# Route to update user data
@app.route('/update_user', methods=['POST'])
def update_user():
    data = request.json
    new_username = data.get('username')
    new_password = data.get('password')
    ip_address = session.get('ip_address')  # Retrieve the IP address from session

    if not new_username or not new_password:
        return jsonify({'success': False, 'message': 'Username and password are required'}), 400

    hashed_password = generate_password_hash(new_password)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE users SET username = %s, password = %s WHERE ip_address = %s",
            (new_username, hashed_password, ip_address)
        )
        conn.commit()
        # Update session with the new username
        session['username'] = new_username
        return jsonify({'success': True, 'message': 'User data updated successfully'})
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify({'success': False, 'message': 'Failed to update user data: ' + str(e)})
    finally:
        cur.close()
        conn.close()




@app.route('/update_mqtt_config', methods=['POST'])
def update_mqtt_config():
    data = request.json
    server = data.get('server')
    port = data.get('port')
    topic = data.get('topic')
    keep_alive = data.get('keepAlive')

    ssh_handler = SSHHandler()
    if not ssh_handler.connect():
        return jsonify({'success': False, 'message': 'Failed to connect to SSH'})

    try:

        file_content = ssh_handler.read_remote_file(REMOTE_CONFIG_META)
        if file_content is None:
            return jsonify({'success': False, 'message': 'Failed to read remote file'})

        print("Original file content:", file_content)

        # Regex-based replacements
        import re
        file_content = re.sub(
            r'mosquitto_connect\(mosq, ".*?", \d+, \d+\);',
            f'mosquitto_connect(mosq, "{server}", {port}, {keep_alive});',
            file_content
        )
        file_content = re.sub(
            r'publish_mqtt_message\(".*?", payload_stream\.str\(\)\);',
            f'publish_mqtt_message("{topic}", payload_stream.str());',
            file_content
        )
        file_content = re.sub(
            r'publish_mqtt_message\(".*?", summary_payload_stream\.str\(\)\);',
            f'publish_mqtt_message("{topic}", summary_payload_stream.str());',
            file_content
        )

        print("Modified file content:", file_content)

        if not ssh_handler.write_remote_file(REMOTE_CONFIG_META, file_content):
            return jsonify({'success': False, 'message': 'Failed to write to remote file'})

        # Post-write verification
        new_content = ssh_handler.read_remote_file(REMOTE_CONFIG_META)
        print("File content after write:", new_content)
        if new_content != file_content:
            return jsonify({'success': False, 'message': 'File verification failed'})

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})
    finally:
        ssh_handler.disconnect()




@app.route('/get_user_stream_count')
def get_user_stream_count():
    username = session.get('username')
    if not username:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401

    # Fetch user ID
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE username = %s", (username,))
    user_id = cur.fetchone()

    if not user_id:
        cur.close()
        conn.close()
        return jsonify({'success': False, 'message': 'User not found'}), 404

    user_id = user_id[0]

    # Count streams associated with the user
    cur.execute("SELECT COUNT(*) FROM streams WHERE user_id = %s", (user_id,))
    stream_count = cur.fetchone()[0]
    cur.close()
    conn.close()

    return jsonify({'success': True, 'user_stream_count': stream_count})


@app.route('/save_mqtt_config', methods=['POST'])
def save_mqtt_config():
    if 'username' not in session:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401

    data = request.json
    server = data.get('server')
    port = data.get('port')
    topic = data.get('topic')
    keep_alive = data.get('keepAlive')

    if not (server and port and topic and keep_alive):
        return jsonify({'success': False, 'message': 'Incomplete data provided'}), 400

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Fetch user ID
        cur.execute("SELECT id FROM users WHERE username = %s", (session['username'],))
        user_id = cur.fetchone()[0]

        # Check if configuration exists for the user
        cur.execute("SELECT id FROM mqtt_configs WHERE user_id = %s", (user_id,))
        config = cur.fetchone()

        if config:
            # Update existing configuration
            cur.execute("""
                UPDATE mqtt_configs
                SET server = %s, port = %s, topic = %s, keep_alive = %s
                WHERE user_id = %s
            """, (server, port, topic, keep_alive, user_id))
        else:
            # Insert new configuration
            cur.execute("""
                INSERT INTO mqtt_configs (user_id, server, port, topic, keep_alive)
                VALUES (%s, %s, %s, %s, %s)
            """, (user_id, server, port, topic, keep_alive))

        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)})
    finally:
        cur.close()
        conn.close()


@app.route('/get_mqtt_config', methods=['GET'])
def get_mqtt_config():
    if 'username' not in session:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Fetch user ID
        cur.execute("SELECT id FROM users WHERE username = %s", (session['username'],))
        user_id = cur.fetchone()[0]

        # Retrieve configuration
        cur.execute("""
            SELECT server, port, topic, keep_alive
            FROM mqtt_configs
            WHERE user_id = %s
        """, (user_id,))
        config = cur.fetchone()

        if config:
            return jsonify({
                'success': True,
                'data': {
                    'server': config[0],
                    'port': config[1],
                    'topic': config[2],
                    'keepAlive': config[3]
                }
            })
        else:
            return jsonify({'success': False, 'message': 'No configuration found'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})
    finally:
        cur.close()
        conn.close()


# Update the toggle_nvds_analytic function
@app.route('/toggle_nvds_analytic', methods=['POST'])
def toggle_nvds_analytic():
    try:
        # Use REMOTE_CONFIG_APP instead of hardcoded path
        content = ssh_handler.read_remote_file(REMOTE_CONFIG_APP)
        if content is None:
            return jsonify({'success': False, 'message': 'Failed to read the remote file.'})

        # Parse the configuration
        config = configparser.ConfigParser(strict=False)
        config.optionxform = str  # Preserve the case of the keys
        config.read_string(content)

        # Check if the section exists
        if 'nvds-analytics' not in config:
            return jsonify({'success': False, 'message': '[nvds-analytics] section not found in the config file.'})

        # Toggle the enable value
        current_value = config.getint('nvds-analytics', 'enable', fallback=0)
        new_value = 0 if current_value == 1 else 1
        config.set('nvds-analytics', 'enable', str(new_value))

        # Prepare the output with no spaces around the '=' sign
        output = StringIO()

        # Manually write the sections and options without spaces around '='
        for section_name in config.sections():
            output.write(f'[{section_name}]\n')  # Write section header
            for option, value in config.items(section_name):
                output.write(f'{option}={value}\n')  # Write option=value without spaces

            # Add a blank line after each section
            output.write('\n')

        # Write to the remote file using REMOTE_CONFIG_APP
        success = ssh_handler.write_remote_file(REMOTE_CONFIG_APP, output.getvalue())

        if success:
            return jsonify({
                'success': True,
                'message': f'Nvds-Analytic successfully {"enabled" if new_value == 1 else "disabled"}.'
            })
        else:
            return jsonify({'success': False, 'message': 'Failed to write the updated file.'})

    except Exception as e:
        return jsonify({'success': False, 'message': f'An error occurred: {str(e)}'})





@app.route('/logout', methods=['GET'])
def logout():
    # Clear the session
    session.clear()
    # Redirect to the login page
    return redirect(url_for('login_page'))





@app.route('/delete_stream', methods=['POST'])
def delete_stream():
    data = request.json
    stream_id = data.get('stream_id')
    
    if not stream_id:
        return jsonify({'success': False, 'message': 'Stream ID is required'}), 400
        
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Start transaction
        cur.execute("BEGIN")
        stream_id = int(stream_id)

        # Check if stream exists and belongs to user
        cur.execute("""
            SELECT id FROM streams 
            WHERE id = %s AND user_id = %s
            FOR UPDATE
        """, (stream_id, user_id))

        if not cur.fetchone():
            raise Exception("Stream not found or unauthorized")

        # Store current stream data in temporary tables
        cur.execute("""
            CREATE TEMP TABLE temp_streams AS 
            SELECT * FROM streams WHERE user_id = %s ORDER BY id
        """, (user_id,))
        
        cur.execute("""
            CREATE TEMP TABLE temp_virtual_loops AS 
            SELECT * FROM virtual_loop_configs WHERE stream_id IN (
                SELECT id FROM streams WHERE user_id = %s
            )
        """, (user_id,))
        
        cur.execute("""
            CREATE TEMP TABLE temp_line_crossings AS 
            SELECT * FROM line_crossing_configs WHERE stream_id IN (
                SELECT id FROM streams WHERE user_id = %s
            )
        """, (user_id,))

        # Delete all configurations and streams for this user
        print(f"Deleting configurations for stream {stream_id}")
        cur.execute("DELETE FROM line_crossing_configs WHERE stream_id IN (SELECT id FROM streams WHERE user_id = %s)", (user_id,))
        cur.execute("DELETE FROM virtual_loop_configs WHERE stream_id IN (SELECT id FROM streams WHERE user_id = %s)", (user_id,))
        cur.execute("DELETE FROM streams WHERE user_id = %s", (user_id,))

        # Get the new ID mapping (excluding the deleted stream)
        cur.execute("SELECT id FROM temp_streams WHERE id != %s ORDER BY id", (stream_id,))
        remaining_streams = [row[0] for row in cur.fetchall()]
        id_mapping = {old_id: new_id for new_id, old_id in enumerate(remaining_streams, 1)}
        print(f"ID mapping: {id_mapping}")

        # Reinsert streams with new IDs if there are any remaining streams
        if id_mapping:
            for old_id, new_id in id_mapping.items():
                # Insert stream
                cur.execute("""
                    INSERT INTO streams (id, user_id, analytics_name, rtsp_url, created_at)
                    SELECT %s, user_id, analytics_name, rtsp_url, created_at
                    FROM temp_streams WHERE id = %s
                """, (new_id, old_id))
                
                # Insert virtual loop configs with new stream_id
                cur.execute("""
                    INSERT INTO virtual_loop_configs (
                        stream_id, roi_number, x1y1_x, x1y1_y, x2y2_x, x2y2_y,
                        x3y3_x, x3y3_y, x4y4_x, x4y4_y, created_at
                    )
                    SELECT %s, roi_number, x1y1_x, x1y1_y, x2y2_x, x2y2_y,
                           x3y3_x, x3y3_y, x4y4_x, x4y4_y, created_at
                    FROM temp_virtual_loops
                    WHERE stream_id = %s
                """, (new_id, old_id))
                
                # Insert line crossing configs with new stream_id, INCLUDING NAME
                cur.execute("""
                    INSERT INTO line_crossing_configs (
                        stream_id, line_number, name, start_x, start_y, end_x, end_y, created_at
                    )
                    SELECT %s, line_number, name, start_x, start_y, end_x, end_y, created_at
                    FROM temp_line_crossings
                    WHERE stream_id = %s
                """, (new_id, old_id))

        # Drop temporary tables
        cur.execute("DROP TABLE temp_streams")
        cur.execute("DROP TABLE temp_virtual_loops")
        cur.execute("DROP TABLE temp_line_crossings")

        # Reset sequences properly handling empty tables
        print("Resetting sequences...")
        cur.execute("""
            SELECT CASE 
                WHEN EXISTS (SELECT 1 FROM streams) THEN
                    setval('streams_id_seq', (SELECT MAX(id) FROM streams))
                ELSE
                    setval('streams_id_seq', 1, false)
                END
        """)
        
        cur.execute("""
            SELECT CASE 
                WHEN EXISTS (SELECT 1 FROM virtual_loop_configs) THEN
                    setval('virtual_loop_configs_id_seq', (SELECT MAX(id) FROM virtual_loop_configs))
                ELSE
                    setval('virtual_loop_configs_id_seq', 1, false)
                END
        """)
        
        cur.execute("""
            SELECT CASE 
                WHEN EXISTS (SELECT 1 FROM line_crossing_configs) THEN
                    setval('line_crossing_configs_id_seq', (SELECT MAX(id) FROM line_crossing_configs))
                ELSE
                    setval('line_crossing_configs_id_seq', 1, false)
                END
        """)

        # Cleanup video stream manager
        video_stream.remove_stream(str(stream_id))
        video_stream.streams.clear()
        video_stream.stream_names.clear()
        video_stream.stream_urls.clear()
        video_stream.locks.clear()

        # Commit transaction
        print("Committing transaction...")
        conn.commit()

        # Reinitialize streams and update configurations
        print("Reinitializing streams...")
        initialize_streams_from_db()

        print("Restart streams...")
        restart_streams()

        print("Updating source configurations...")
        if not update_source_configs():
            return jsonify({'success': False, 'message': 'Failed to update source configurations'})

        print("Updating analytics configurations...")
        if not update_analytics_configs():
            return jsonify({'success': False, 'message': 'Failed to update analytics configurations'})

        return jsonify({'success': True})

    except Exception as e:
        print(f"Delete stream error: {str(e)}")
        conn.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        cur.close()
        conn.close()







@app.route('/restart_streams', methods=['POST'])
def restart_streams():
    try:
        # Create a shell script that uses sudo
        restart_cmd = "echo 'Dyna1234' | sudo -S systemctl restart deepstream.service"
        
        # Execute the command
        process = subprocess.Popen(
            restart_cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        # Wait for the command to complete with a timeout
        try:
            stdout, stderr = process.communicate(timeout=10)
            
            if process.returncode == 0:
                time.sleep(2)  # Give the service a moment to start
                return jsonify({'success': True})
            else:
                error_message = stderr.decode() if stderr else 'Failed to restart deepstream service'
                print(f"Restart error: {error_message}")
                return jsonify({'success': False, 'error': error_message})
                
        except subprocess.TimeoutExpired:
            process.kill()
            return jsonify({'success': False, 'error': 'Restart command timed out'})
            
    except Exception as e:
        print(f"Error restarting streams: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/system-data')
def get_system_data():
    try:
        # Initialize system data with default values
        system_data = {
            'blockStatus': {
                'type': 'Embedded micro',
                'version': '1.0.0',
                'serialNumber': 'JS-001',
                'currentBlockTime': datetime.now().isoformat(),
                'onlineSince': datetime.now().isoformat(),
                'uptime': '-'
            },
            'systemPerformance': {
                'uptime': '-',
                'avgCpuUtil': '-',
                'cpuUtil': '-',
                'cpuTemp': '-',
                'cpuName': 'ARM v8 (Cortex)',
                'gpuFanSpeed': '-',
                'gpuTemp': '-',
                'gpuPower': '-',
                'gpuUtil': '-',
                'gpuMemUtil': '-',
                'gpuEncoderUtil': '-',
                'gpuDecoderUtil': '-',
                'gpuClock': '-',
                'gpuSmClock': '-',
                'gpuMemClock': '-',
                'gpuVideoClock': '-',
                'gpuName': 'NVIDIA Tegra',
                'gpuDriver': '-',
                'memUsed': '-',
                'memTotal': '-',
                'swapUsed': '-',
                'swapTotal': '-'
            }
        }

        # Get tegrastats output using different methods
        tegrastats = None
        try:
            # Method 1: Using Popen
            print("Attempting to get tegrastats using Popen...")
            cmd = ['sudo', 'tegrastats']
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True
            )
            
            tegrastats = process.stdout.readline().strip()
            print(f"Tegrastats output (Method 1): {tegrastats}")
            
            process.terminate()
            process.wait(timeout=1)
            
            if not tegrastats:
                # Method 2: Using check_output
                print("Method 1 failed, trying Method 2 with check_output...")
                tegrastats = subprocess.check_output(
                    ['sudo', 'tegrastats'],
                    stderr=subprocess.PIPE,
                    universal_newlines=True,
                    timeout=2
                ).split('\n')[0]
                print(f"Tegrastats output (Method 2): {tegrastats}")

        except Exception as e:
            print(f"Error getting tegrastats: {str(e)}")

        if tegrastats:
            try:
                # Parse RAM usage
                ram_match = re.search(r'RAM (\d+)/(\d+)MB', tegrastats)
                if ram_match:
                    used_mb = int(ram_match.group(1))
                    total_mb = int(ram_match.group(2))
                    system_data['systemPerformance']['memUsed'] = f"{used_mb/1024:.2f} GB"
                    system_data['systemPerformance']['memTotal'] = f"{total_mb/1024:.2f} GB"
                    system_data['systemPerformance']['gpuMemUtil'] = f"{(used_mb/total_mb*100):.1f}%"

                # Parse CPU usage
                cpu_match = re.search(r'CPU \[(.*?)\]', tegrastats)
                if cpu_match:
                    cpu_stats = cpu_match.group(1).split(',')
                    cpu_percentages = []
                    for stat in cpu_stats:
                        try:
                            percentage = int(stat.split('%')[0])
                            cpu_percentages.append(percentage)
                        except (ValueError, IndexError):
                            continue
                    
                    if cpu_percentages:
                        avg_cpu = sum(cpu_percentages) / len(cpu_percentages)
                        system_data['systemPerformance']['cpuUtil'] = f"{avg_cpu:.1f}%"
                        system_data['systemPerformance']['avgCpuUtil'] = f"{avg_cpu:.1f}%"

                # Parse temperatures
                for temp_match in re.finditer(r'(\w+)@([\d.]+)C', tegrastats):
                    component = temp_match.group(1)
                    temp = temp_match.group(2)
                    if component == 'cpu':
                        system_data['systemPerformance']['cpuTemp'] = f"{temp}°C"
                    elif component == 'gpu':
                        system_data['systemPerformance']['gpuTemp'] = f"{temp}°C"

                # Parse GPU metrics
                gpu_match = re.search(r'GR3D_FREQ (\d+)%@\[(\d+)\]', tegrastats)
                if gpu_match:
                    system_data['systemPerformance']['gpuUtil'] = f"{gpu_match.group(1)}%"
                    system_data['systemPerformance']['gpuClock'] = f"{gpu_match.group(2)} MHz"

                # Parse encoder/decoder utilization
                enc_match = re.search(r'NVENC (\d+)%', tegrastats)
                if enc_match:
                    system_data['systemPerformance']['gpuEncoderUtil'] = f"{enc_match.group(1)}%"

                dec_match = re.search(r'NVDEC (\d+)%', tegrastats)
                if dec_match:
                    system_data['systemPerformance']['gpuDecoderUtil'] = f"{dec_match.group(1)}%"

                # Parse power consumption
                power_match = re.search(r'VDD_IN (\d+)mW', tegrastats)
                if power_match:
                    power_mw = int(power_match.group(1))
                    system_data['systemPerformance']['gpuPower'] = f"{power_mw/1000:.2f} W"

            except Exception as e:
                print(f"Error parsing tegrastats output: {str(e)}")

        # Get uptime
        try:
            with open('/proc/uptime', 'r') as f:
                uptime_seconds = float(f.read().split()[0])
                days = int(uptime_seconds // (24 * 3600))
                hours = int((uptime_seconds % (24 * 3600)) // 3600)
                minutes = int((uptime_seconds % 3600) // 60)
                uptime_str = f"{days}d {hours}h {minutes}m"
                system_data['blockStatus']['uptime'] = uptime_str
                system_data['systemPerformance']['uptime'] = uptime_str
        except Exception as e:
            print(f"Error reading uptime: {str(e)}")

        # Add network status information
        try:
            # Check internet connectivity and delay
            internet_status = {'access': False, 'delay': 'N/A'}
            try:
                cmd = ['ping', '-c', '1', '8.8.8.8']
                output = subprocess.check_output(cmd, stderr=subprocess.STDOUT, universal_newlines=True)
                match = re.search(r'time=(\d+\.?\d*)', output)
                internet_status = {
                    'access': True,
                    'delay': f"{match.group(1) if match else 'N/A'} ms"
                }
            except subprocess.CalledProcessError:
                pass

            # Check DNS resolution
            try:
                socket.gethostbyname('google.com')
                dns_access = True
            except socket.gaierror:
                dns_access = False

            # Check VPN status
            try:
                cmd = "ip a | grep tun"
                vpn_interfaces = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL)
                local_vpn = bool(vpn_interfaces)
            except subprocess.CalledProcessError:
                local_vpn = False

            try:
                cmd = "systemctl is-active openvpn"
                status = subprocess.check_output(cmd, shell=True).decode().strip()
                server_vpn = status == 'active'
            except subprocess.CalledProcessError:
                server_vpn = False

            # Check VPN port
            try:
                cmd = "ss -tuln | grep ':1194'"
                output = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL)
                vpn_port_open = bool(output)
            except subprocess.CalledProcessError:
                vpn_port_open = False

            # Get network interfaces
            interfaces = []
            try:
                with open('/proc/net/dev') as f:
                    lines = f.readlines()[2:]  # Skip headers
                    
                for line in lines:
                    interface = {}
                    parts = line.split(':')
                    if len(parts) < 2:
                        continue
                        
                    interface['name'] = parts[0].strip()
                    stats = parts[1].split()
                    
                    # Skip loopback interface
                    if interface['name'] == 'lo':
                        continue
                        
                    # Get IP address
                    try:
                        cmd = f"ip addr show {interface['name']} | grep 'inet ' | awk '{{print $2}}'"
                        ip = subprocess.check_output(cmd, shell=True).decode().strip()
                        interface['ipAddress'] = ip
                    except subprocess.CalledProcessError:
                        interface['ipAddress'] = 'N/A'
                    
                    # Convert bytes to human-readable format
                    def bytes_to_human(bytes_value):
                        for unit in ['B', 'KB', 'MB', 'GB']:
                            if float(bytes_value) < 1024:
                                return f"{float(bytes_value):.2f} {unit}"
                            bytes_value = float(bytes_value) / 1024
                        return f"{float(bytes_value):.2f} TB"
                    
                    interface['receive'] = bytes_to_human(stats[0])
                    interface['totalReceived'] = bytes_to_human(stats[0])
                    interface['transmit'] = bytes_to_human(stats[8])
                    interface['totalTransmitted'] = bytes_to_human(stats[8])
                    
                    interfaces.append(interface)
            except Exception as e:
                print(f"Error getting network interfaces: {str(e)}")

            # Add network status to system data
            system_data['networkStatus'] = {
                'internetAccess': internet_status['access'],
                'internetDelay': internet_status['delay'],
                'dnsAccess': dns_access,
                'localVpn': local_vpn,
                'serverVpn': server_vpn,
                'serverVpnPort': vpn_port_open,
                'interfaces': interfaces
            }

        except Exception as e:
            print(f"Error collecting network status: {str(e)}")
            system_data['networkStatus'] = {
                'internetAccess': False,
                'internetDelay': 'N/A',
                'dnsAccess': False,
                'localVpn': False,
                'serverVpn': False,
                'serverVpnPort': False,
                'interfaces': []
            }

        swap_info = get_swap_info()
        system_data['systemPerformance'].update(swap_info)
        return jsonify(system_data)
    except Exception as e:
        print(f"Error in get_system_data: {str(e)}")
        return jsonify({'error': str(e)}), 500 



@app.route('/api/smart-disk-status')
def smart_disk_status():
    return jsonify(get_disk_info())



@app.route('/check_session', methods=['GET'])
def check_session():
    if 'username' in session:
        return jsonify({'loggedIn': True})
    return jsonify({'loggedIn': False})


from flask import abort

@app.route('/admin')
def admin_page():
    if 'username' not in session or session.get('role') != 'admin':
        abort(403)  # Forbidden
    return render_template('admin.html')


@app.errorhandler(403)
def forbidden(error):
    return render_template('403.html'), 403



@app.route('/diagnostics')
def diagnostics():
    if 'username' not in session:
        return redirect(url_for('login_page'))
    return render_template('Diagnostics.html')  





@app.route('/save_auto_recover', methods=['POST'])
def save_auto_recover():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401
        
    try:
        data = request.json
        user_id = session['user_id']
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("BEGIN")
        
        try:
            # Check if settings already exist for user
            cur.execute("SELECT id FROM auto_recover_settings WHERE user_id = %s FOR UPDATE", (user_id,))
            existing = cur.fetchone()
            
            if existing:
                # Update existing settings
                cur.execute("""
                    UPDATE auto_recover_settings 
                    SET enabled = %s,
                        interval_days = %s,
                        interval_hours = %s,
                        interval_minutes = %s,
                        start_time = %s,
                        action_type = %s,
                        updated_at = CURRENT_TIMESTAMP,
                        last_executed = NULL
                    WHERE user_id = %s
                    """, (
                        data['enabled'],
                        data['interval_days'],
                        data['interval_hours'],
                        data['interval_minutes'],
                        data['start_time'],
                        data['action_type'],
                        user_id
                    ))
            else:
                # Insert new settings
                cur.execute("""
                    INSERT INTO auto_recover_settings 
                    (user_id, enabled, interval_days, interval_hours, interval_minutes,
                     start_time, action_type, last_executed)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NULL)
                    """, (
                        user_id,
                        data['enabled'],
                        data['interval_days'],
                        data['interval_hours'],
                        data['interval_minutes'],
                        data['start_time'],
                        data['action_type']
                    ))
            
            cur.execute("COMMIT")
            return jsonify({'success': True})
            
        except Exception as e:
            cur.execute("ROLLBACK")
            raise e
            
    except Exception as e:
        print(f"Error saving auto-recover settings: {str(e)}")
        return jsonify({'success': False, 'message': str(e)})
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()




@app.route('/get_auto_recover', methods=['GET'])
def get_auto_recover():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT enabled, interval_days, interval_hours, interval_minutes, 
                   start_time, action_type
            FROM auto_recover_settings 
            WHERE user_id = %s
        """, (session['user_id'],))
        
        settings = cur.fetchone()
        
        if settings:
            return jsonify({
                'success': True,
                'data': {
                    'enabled': settings[0],
                    'interval_days': settings[1],
                    'interval_hours': settings[2],
                    'interval_minutes': settings[3],
                    'start_time': settings[4].isoformat() if settings[4] else None,
                    'action_type': settings[5]
                }
            })
        return jsonify({'success': True, 'data': None})
        
    except Exception as e:
        print(f"Error getting auto-recover settings: {str(e)}")
        return jsonify({'success': False, 'message': str(e)})
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()




@app.route('/execute_action/<action_type>', methods=['POST'])
def execute_action(action_type):
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401
        
    if action_type not in ['reboot-node', 'reboot-block', 'reboot-both', 'hw-reset']:
        return jsonify({'success': False, 'message': 'Invalid action type'})
        
    success = execute_recovery_action(action_type)
    return jsonify({'success': success})

@app.route('/upload_ssl_files', methods=['POST'])
def upload_ssl_files():
    if 'cert_file' not in request.files or 'key_file' not in request.files:
        return jsonify({'success': False, 'message': 'Missing certificate or key file'})
        
    cert_file = request.files['cert_file']
    key_file = request.files['key_file']
    
    if cert_file.filename == '' or key_file.filename == '':
        return jsonify({'success': False, 'message': 'No selected files'})
        
    try:
        # Create SSL directory if it doesn't exist
        os.makedirs(SSL_UPLOAD_FOLDER, exist_ok=True)
        
        # Save the files
        cert_path = os.path.join(SSL_UPLOAD_FOLDER, 'cert.crt')
        key_path = os.path.join(SSL_UPLOAD_FOLDER, 'cert.key')
        
        cert_file.save(cert_path)
        key_file.save(key_path)
        
        # Update mjpeg.py configuration
        success = update_mjpeg_config(cert_path, key_path)
        if not success:
            return jsonify({'success': False, 'message': 'Failed to update mjpeg configuration'})
            
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/replace_ssl_default', methods=['POST'])
def replace_ssl_default():
    try:
        # Remove custom SSL files if they exist
        cert_path = os.path.join(SSL_UPLOAD_FOLDER, 'cert.crt')
        key_path = os.path.join(SSL_UPLOAD_FOLDER, 'cert.key')
        
        if os.path.exists(cert_path):
            os.remove(cert_path)
        if os.path.exists(key_path):
            os.remove(key_path)
            
        # Update mjpeg.py to use default configuration
        success = update_mjpeg_config(use_default=True)
        if not success:
            return jsonify({'success': False, 'message': 'Failed to restore default configuration'})
            
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

def update_mjpeg_config(cert_path=None, key_path=None, use_default=False):
    try:
        # Read mjpeg.py content
        mjpeg_path = '/opt/nvidia/deepstream/deepstream-7.0/sources/apps/sample_apps/deepstream-nvdsanalytics-test/mjpeg.py'
        with open(mjpeg_path, 'r') as f:
            content = f.read()
            
        # Prepare new app.run line
        if use_default:
            new_line = "app.run(host='0.0.0.0', port=8088, debug=False)"
        else:
            new_line = f"app.run(host='0.0.0.0', port=8088, ssl_context=('{cert_path}','{key_path}'), debug=False)"
            
        # Replace existing app.run line using regex
        import re
        pattern = r"app\.run\(.*\)"
        content = re.sub(pattern, new_line, content)
        
        # Write updated content back to file
        with open(mjpeg_path, 'w') as f:
            f.write(content)
            
        # Restart the mjpeg service
        os.system('sudo systemctl restart stream')
        
        return True
        
    except Exception as e:
        print(f"Error updating mjpeg config: {str(e)}")
        return False


# Add this route to app.py
@app.route('/get_certificate_info', methods=['GET'])
def get_current_certificate_info():
    try:
        cert_path = os.path.join(SSL_UPLOAD_FOLDER, 'cert.crt')
        
        # Check if certificate exists
        if not os.path.exists(cert_path):
            return jsonify({
                'success': False,
                'message': 'No certificate found'
            })
            
        cert_info = get_certificate_info(cert_path)
        if cert_info:
            return jsonify({
                'success': True,
                'data': {
                    'issuer_name': cert_info['issuer'],
                    'subject_name': cert_info['subject'],
                    'effective_timestamp': cert_info['effective_timestamp'],
                    'expiry_timestamp': cert_info['expiry_timestamp'],
                    'version': cert_info['version'],
                    'is_self_signed': cert_info['is_self_signed'],
                    'blacklisted': False  # You can implement blacklist checking if needed
                }
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Failed to read certificate information'
            })
            
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        })


@app.route('/get_terminal_ip', methods=['GET'])
def get_terminal_ip_route():
    terminal_ip = get_terminal_ip()
    if terminal_ip:
        return jsonify({'success': True, 'ip': terminal_ip})
    return jsonify({'success': False, 'message': 'Could not determine terminal IP'})




@app.route('/get_stream_settings/<stream_id>')
def get_stream_settings(stream_id):
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Get stream settings
        cur.execute("""
            SELECT analytics_name, rtsp_url 
            FROM streams 
            WHERE id = %s AND user_id = %s
        """, (stream_id, session['user_id']))
        
        stream = cur.fetchone()
        if stream:
            return jsonify({
                'success': True,
                'analytics_name': stream[0],
                'rtsp_url': stream[1]
            })
        else:
            return jsonify({'success': False, 'message': 'Stream not found'})
            
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})
    finally:
        cur.close()
        conn.close()



@app.route('/update_stream_settings', methods=['POST'])
def update_stream_settings():
    if 'user_id' not in session:
        return jsonify({'success': False, 'message': 'User not logged in'}), 401
        
    data = request.json
    stream_id = data.get('stream_id')
    analytics_name = data.get('analytics_name')
    rtsp_url = data.get('rtsp_url')
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Start transaction
        cur.execute("BEGIN")
        
        # Store all streams in a temporary table, ordered by creation time
        cur.execute("""
            CREATE TEMP TABLE temp_streams AS 
            SELECT * FROM streams 
            WHERE user_id = %s 
            ORDER BY created_at
        """, (session['user_id'],))
        
        # Update the specific stream in temp table
        cur.execute("""
            UPDATE temp_streams 
            SET analytics_name = %s, rtsp_url = %s 
            WHERE id = %s
        """, (analytics_name, rtsp_url, stream_id))
        
        # Delete existing streams
        cur.execute("DELETE FROM streams WHERE user_id = %s", (session['user_id'],))
        
        # Reinsert streams with sequential IDs
        cur.execute("""
            INSERT INTO streams (id, user_id, analytics_name, rtsp_url, created_at)
            SELECT 
                ROW_NUMBER() OVER (ORDER BY created_at) as new_id,
                user_id,
                analytics_name,
                rtsp_url,
                created_at
            FROM temp_streams
        """)
        
        # Reset the sequence
        cur.execute("""
            SELECT setval('streams_id_seq', 
                         (SELECT MAX(id) FROM streams), 
                         true)
        """)
        
        # Drop temporary table
        cur.execute("DROP TABLE temp_streams")
        
        # Update configurations
        if not update_source_configs():
            raise Exception('Failed to update source configurations')

        # Update RTSP URL in remote config via SSH
        try:
            # Read the remote config file
            content = ssh_handler.read_remote_file(REMOTE_CONFIG_APP)
            if content is None:
                raise Exception('Failed to read remote config file')

            # Parse the configuration
            config = configparser.ConfigParser(allow_no_value=True, delimiters=('='))
            config.optionxform = str  # Preserve case
            config.read_string(content)

            # Update the uri in the corresponding source section
            section_name = f'source{int(stream_id) - 1}'  # Adjust stream ID to 0-based index
            if config.has_section(section_name):
                config.set(section_name, 'uri', rtsp_url)

                # Write back to string buffer
                output = StringIO()
                for section in config.sections():
                    output.write(f'[{section}]\n')
                    for key, value in config.items(section):
                        if value is not None:
                            output.write(f'{key}={value}\n')
                        else:
                            output.write(f'{key}\n')
                    output.write('\n')

                # Write to SSH file
                if not ssh_handler.write_remote_file(REMOTE_CONFIG_APP, output.getvalue()):
                    raise Exception('Failed to write to remote config file')
            else:
                raise Exception(f'Section {section_name} not found in config file')

        except Exception as e:
            print(f"Error updating remote config: {str(e)}")
            raise Exception(f'Failed to update remote config: {str(e)}')
        
        # Commit transaction
        cur.execute("COMMIT")
        
        # Reinitialize video streams
        video_stream.streams.clear()
        video_stream.stream_names.clear()
        video_stream.stream_urls.clear()
        video_stream.locks.clear()
        initialize_streams_from_db()
        
        return jsonify({'success': True})
            
    except Exception as e:
        cur.execute("ROLLBACK")
        print(f"Error updating stream settings: {str(e)}")
        return jsonify({'success': False, 'message': str(e)})
    finally:
        cur.close()
        conn.close()



@app.route('/upload_engine', methods=['POST'])
def upload_engine():
    if 'engine_file' not in request.files:
        return jsonify({'success': False, 'message': 'No file provided'})
        
    file = request.files['engine_file']
    if file.filename == '':
        return jsonify({'success': False, 'message': 'No file selected'})
        
    if not file.filename.endswith('.engine'):
        return jsonify({'success': False, 'message': 'Invalid file type'})
        
    try:
        # Save the engine file
        engine_dir = '/opt/nvidia/deepstream/deepstream-7.0/sources/apps/sample_apps/deepstream-nvdsanalytics-test/Engine'
        os.makedirs(engine_dir, exist_ok=True)
        
        filename = secure_filename(file.filename)
        file_path = os.path.join(engine_dir, filename)
        file.save(file_path)
        
        # Update the config file
        config_path = '/opt/nvidia/deepstream/deepstream-7.0/sources/apps/sample_apps/deepstream-nvdsanalytics-test/DeepStream-Yolo/config_infer_primary_yolonas.txt'
        
        # Read the current config
        with open(config_path, 'r') as f:
            config_lines = f.readlines()
            
        # Update the model-engine-file line
        for i, line in enumerate(config_lines):
            if line.startswith('model-engine-file='):
                config_lines[i] = f'model-engine-file={file_path}\n'
                break
                
        # Write the updated config
        with open(config_path, 'w') as f:
            f.writelines(config_lines)
            
        # Restart streams after updating configuration
        restart_streams()
            
        return jsonify({
            'success': True,
            'message': 'Engine file uploaded and config updated successfully'
        })
        
    except Exception as e:
        print(f"Error in upload_engine: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Error: {str(e)}'
        })


# UPDATE TOO = sudo visudo

# dyna ALL=(ALL) NOPASSWD: /bin/date, /sbin/hwclock
# dyna ALL=(ALL) NOPASSWD: /bin/systemctl restart deepstream
# dyna ALL=(ALL) NOPASSWD: /bin/systemctl restart stream
# dyna ALL=(ALL) NOPASSWD: /bin/systemctl restart DynaApp
# dyna ALL=(ALL) NOPASSWD: /sbin/reboot
# dyna ALL=(ALL) NOPASSWD: /usr/bin/tegrastats
# dyna ALL=(ALL) NOPASSWD: /usr/sbin/smartctl
# dyna ALL=(ALL) NOPASSWD: /bin/ping
# dyna ALL=(ALL) NOPASSWD: /usr/bin/ss
# dyna ALL=(ALL) NOPASSWD: /usr/sbin/ip
# dyna ALL=(ALL) NOPASSWD: /bin/systemctl status openvpn



#INSTALLED PACKAGE:

# sudo apt-get install smartmontools
# which tegrastats
# sudo apt-get update
# sudo apt-get install openssl

if __name__ == "__main__":
    # Start the auto-recover thread before running the app
    thread = threading.Thread(target=auto_recover_thread, daemon=True)
    thread.start()
    
    # Run the Flask app
    app.run(
        host="0.0.0.0",
        port=8080,
        debug=True,
        threaded=True,
        use_reloader=True
    )

    # Optional: Add SSL context if needed
    # app.run(ssl_context='adhoc')  # Requires 'pip install pyOpenSSL'
