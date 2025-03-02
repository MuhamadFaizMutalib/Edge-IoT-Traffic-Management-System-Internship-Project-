function navigateToIndex() {
    window.location.href = "/index";
}


function saveMQTTConfig() {
    const server = document.getElementById('mqtt-server').value;
    const port = document.getElementById('mqtt-port').value;
    const topic = document.getElementById('mqtt-topic').value;
    const keepAlive = document.getElementById('mqtt-keep-alive').value;

    console.log("Saving MQTT configuration:", { server, port, topic, keepAlive });

    // Save to database
    fetch('/save_mqtt_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server, port, topic, keepAlive })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // alert('MQTT configuration saved to database successfully');

            // Update file via SSH
            fetch('/update_mqtt_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ server, port, topic, keepAlive })
            })
            .then(sshResponse => sshResponse.json())
            .then(sshData => {
                if (sshData.success) {
                    alert('MQTT configuration updated Successfully');
                } else {
                    alert('Failed to update MQTT configuration via SSH: ' + sshData.message);
                }
            })
            .catch(error => console.error('Error updating MQTT configuration via SSH:', error));
        } else {
            alert('Failed to save MQTT configuration to database: ' + data.message);
        }
    })
    .catch(error => console.error('Error saving MQTT configuration:', error));
}

// Handle section expansion with debugging
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.settings-section .section-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const icon = header.querySelector('.fa-chevron-down, .fa-chevron-right');
            
            console.log('Current icon classes:', icon.classList);
            
            if (content) {
                if (content.style.display === 'none' || !content.style.display) {
                    content.style.display = 'block';
                    icon.classList.remove('fa-chevron-right');
                    icon.classList.add('fa-chevron-down');
                    console.log('Expanding section - new icon classes:', icon.classList);
                } else {
                    content.style.display = 'none';
                    icon.classList.remove('fa-chevron-down');
                    icon.classList.add('fa-chevron-right');
                    console.log('Collapsing section - new icon classes:', icon.classList);
                }
            }
        });

        // Set initial states for all sections
        const content = header.nextElementSibling;
        const icon = header.querySelector('.fa-chevron-down, .fa-chevron-right');
        
        // Make sure content has a default display state
        if (!content.style.display) {
            content.style.display = 'block';
            if (icon) {
                icon.classList.remove('fa-chevron-right');
                icon.classList.add('fa-chevron-down');
            }
        }
    });
});


document.addEventListener("DOMContentLoaded", () => {
    fetch('/get_mqtt_config')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('mqtt-server').value = data.data.server;
                document.getElementById('mqtt-port').value = data.data.port;
                document.getElementById('mqtt-topic').value = data.data.topic;
                document.getElementById('mqtt-keep-alive').value = data.data.keepAlive;
            } else {
                console.error('Failed to load MQTT configuration:', data.message);
            }
        })
        .catch(error => console.error('Error fetching MQTT configuration:', error));
});


// Update time display function to show both local and UTC time
function updateCurrentTime() {
    const timeElement = document.getElementById('current-time');
    const now = new Date();
    const localTime = now.toLocaleString();
    const utcTime = now.toISOString().replace('T', ' ').substr(0, 19) + ' UTC';
    timeElement.textContent = `${localTime} (${utcTime})`;
}

setInterval(updateCurrentTime, 1000);
updateCurrentTime();


// Update current block time
function updateBlockTime() {
    const timeElement = document.getElementById('current-block-time');
    const now = new Date();
    timeElement.textContent = now.toISOString().replace('T', ' ').substr(0, 19) + ' UTC';
}

// Initialize real-time clock update
setInterval(updateBlockTime, 1000);
updateBlockTime();





// Handle toggle switch
document.addEventListener('DOMContentLoaded', function() {
    const toggle = document.getElementById('auto-recover-toggle');
    const advancedOptions = document.getElementById('advanced-options');
    const toggleStatus = document.getElementById('toggle-status');
    const saveButton = document.getElementById('save-settings');

    // Initially disable save button
    saveButton.disabled = true;
    saveButton.classList.remove('active');

    if (toggle) {
        toggle.addEventListener('change', function() {
            // Update UI based on toggle state
            if (this.checked) {
                advancedOptions.style.display = 'block';
                toggleStatus.textContent = 'The device automatically perform the selected action every';
                saveButton.classList.add('active');
                saveButton.disabled = false;
            } else {
                advancedOptions.style.display = 'none';
                toggleStatus.textContent = 'Action disabled';
                saveButton.classList.remove('active');
                saveButton.disabled = true;

                // Immediately update database when disabling
                updateAutoRecoverStatus(false);
            }
        });
    }
});



// Function to update auto recover status in database
function updateAutoRecoverStatus(enabled) {
    const data = {
        enabled: enabled,
        interval_days: 0,
        interval_hours: 0,
        interval_minutes: 0,
        interval_seconds: 0,
        start_time: new Date().toISOString(),
        action_type: 'reboot-block' // Default action type
    };

    fetch('/save_auto_recover', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            console.error('Failed to update auto recover status:', data.message);
            // Optionally revert the toggle if update fails
            // toggle.checked = !toggle.checked;
        }
    })
    .catch(error => {
        console.error('Error updating auto recover status:', error);
    });
}



// Update event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Load saved settings
    loadAutoRecoverSettings();
    
    // Add input validation for interval
    const intervalInput = document.getElementById('days-input');
    intervalInput.addEventListener('blur', function() {
        const interval = parseInterval(this.value);
        if (!interval) {
            alert('Invalid interval format. Use format like "1d", "24h", "60m", or "10m"');
            this.value = '1d'; // Reset to default
        }
    });
    
    // Update reboot function handlers
    document.querySelector('[onclick="rebootNodeNow()"]').onclick = () => executeAction('reboot-node');
    document.querySelector('[onclick="rebootBlockNow()"]').onclick = () => executeAction('reboot-block');
    document.querySelector('[onclick="systemRebootNow()"]').onclick = () => executeAction('reboot-both');
    
    // Update save button handler - single event listener
    const saveButton = document.getElementById('save-settings');
    if (saveButton) {
        saveButton.addEventListener('click', saveAutoRecoverSettings);
    }
});


// Updated save settings function
function saveAutoRecoverSettings() {
    const toggle = document.getElementById('auto-recover-toggle');
    if (!toggle.checked) {
        return;
    }

    const intervalStr = document.getElementById('days-input').value;
    const startTimeLocal = flatpickrInstance.selectedDates[0];
    const action = document.querySelector('input[name="recover-action"]:checked').value;
    
    if (!startTimeLocal) {
        alert('Please select a start date and time');
        return;
    }
    
    const interval = parseInterval(intervalStr);
    if (!interval) {
        return; // parseInterval will show appropriate error message
    }
    
    const data = {
        enabled: toggle.checked,
        interval_days: interval.days,
        interval_hours: interval.hours,
        interval_minutes: interval.minutes,
        interval_seconds: 0, // Always 0 now
        start_time: startTimeLocal.toISOString(),
        action_type: action
    };
    
    fetch('/save_auto_recover', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Settings saved successfully');
        } else {
            alert('Failed to save settings: ' + data.message);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to save settings');
    });
}



// Reboot functions
function rebootNodeNow() {
    if (confirm('Are you sure you want to reboot the node NOW?')) {
        console.log('Rebooting node...');
    }
}

function rebootBlockNow() {
    if (confirm('Are you sure you want to reboot the block NOW?')) {
        console.log('Rebooting block...');
    }
}

function systemRebootNow() {
    if (confirm('Are you sure you want to perform a system reboot NOW?')) {
        console.log('Performing system reboot...');
    }
}


// Function to parse interval string into components (days, hours, minutes)
function parseInterval(intervalStr) {
    const regex = /(\d+)([dhm])/;
    const match = intervalStr.match(regex);
    if (!match) return null;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    const result = {
        days: 0,
        hours: 0,
        minutes: 0
    };
    
    switch(unit) {
        case 'd': 
            result.days = value; 
            break;
        case 'h': 
            result.hours = value; 
            break;
        case 'm': 
            // Validate minimum 10 minutes
            if (value < 10) {
                alert('Minimum interval is 10 minutes');
                return null;
            }
            result.minutes = value; 
            break;
        default:
            return null;
    }
    
    return result;
}


// Function to format interval into display string
function formatInterval(days, hours, minutes) {
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes >= 10) return `${minutes}m`;
    return '10m'; // Default minimum
}

// Function to validate interval input
function validateIntervalInput(inputElement) {
    const value = inputElement.value;
    const regex = /^(\d+)([dhm])$/;
    const match = value.match(regex);
    
    if (!match) {
        alert('Invalid format. Use format like "1d", "24h", or "10m"');
        inputElement.value = '10m'; // Reset to minimum valid value
        return false;
    }
    
    const number = parseInt(match[1]);
    const unit = match[2];
    
    if (unit === 'm' && number < 10) {
        alert('Minimum interval is 10 minutes');
        inputElement.value = '10m';
        return false;
    }
    
    return true;
}



// Update loadAutoRecoverSettings to handle button state
function loadAutoRecoverSettings() {
    fetch('/get_auto_recover')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.data) {
                const settings = data.data;
                
                // Update toggle and save button state
                const toggle = document.getElementById('auto-recover-toggle');
                const saveButton = document.getElementById('save-settings');
                
                toggle.checked = settings.enabled;
                saveButton.disabled = !settings.enabled;
                if (settings.enabled) {
                    saveButton.classList.add('active');
                } else {
                    saveButton.classList.remove('active');
                }
                
                // Trigger change event to update UI
                toggle.dispatchEvent(new Event('change'));
                
                // Update other settings...
                const interval = formatInterval(
                    settings.interval_days,
                    settings.interval_hours,
                    settings.interval_minutes,
                    settings.interval_seconds
                );
                document.getElementById('days-input').value = interval;
                
                if (settings.start_time) {
                    const formattedTime = formatDateTimeForDisplay(settings.start_time);
                    flatpickrInstance.setDate(formattedTime, true);
                }
                
                const actionRadio = document.querySelector(`input[name="recover-action"][value="${settings.action_type}"]`);
                if (actionRadio) {
                    actionRadio.checked = true;
                }
            }
        })
        .catch(error => console.error('Error loading settings:', error));
}



// Execute immediate actions
function executeAction(actionType) {
    if (!confirm(`Are you sure you want to ${actionType.replace('-', ' ')} NOW?`)) {
        return;
    }
    
    fetch(`/execute_action/${actionType}`, {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert(`${actionType.replace('-', ' ')} initiated successfully`);
        } else {
            alert('Failed to execute action: ' + data.message);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to execute action');
    });
}


// Function to format datetime for display (keep existing function)
function formatDateTimeForDisplay(isoString) {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}


let flatpickrInstance;

document.addEventListener('DOMContentLoaded', function() {
    // Initialize Flatpickr with options
    flatpickrInstance = flatpickr("#time-input", {
        enableTime: true,
        dateFormat: "Y-m-d H:i:S",
        time_24hr: true,
        minuteIncrement: 1,
        defaultHour: new Date().getHours(),
        defaultMinute: new Date().getMinutes(),
        allowInput: true,
        onChange: function(selectedDates, dateStr) {
            // Update the input value when a date is selected
            document.getElementById('time-input').value = dateStr;
        }
    });

    // Add clear button functionality
    document.getElementById('clear-datetime').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        flatpickrInstance.clear();
    });
});


// Add input validation listener
document.addEventListener('DOMContentLoaded', function() {
    const intervalInput = document.getElementById('days-input');
    intervalInput.addEventListener('blur', function() {
        validateIntervalInput(this);
    });

    // Update load settings to use new format
    function loadAutoRecoverSettings() {
        fetch('/get_auto_recover')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.data) {
                    const settings = data.data;
                    
                    const toggle = document.getElementById('auto-recover-toggle');
                    const saveButton = document.getElementById('save-settings');
                    
                    toggle.checked = settings.enabled;
                    saveButton.disabled = !settings.enabled;
                    if (settings.enabled) {
                        saveButton.classList.add('active');
                    } else {
                        saveButton.classList.remove('active');
                    }
                    
                    toggle.dispatchEvent(new Event('change'));
                    
                    const interval = formatInterval(
                        settings.interval_days,
                        settings.interval_hours,
                        settings.interval_minutes
                    );
                    document.getElementById('days-input').value = interval;
                    
                    if (settings.start_time) {
                        const formattedTime = formatDateTimeForDisplay(settings.start_time);
                        flatpickrInstance.setDate(formattedTime, true);
                    }
                    
                    const actionRadio = document.querySelector(`input[name="recover-action"][value="${settings.action_type}"]`);
                    if (actionRadio) {
                        actionRadio.checked = true;
                    }
                }
            })
            .catch(error => console.error('Error loading settings:', error));
    }


    // Load settings on page load
    loadAutoRecoverSettings();
});


// Update the network configuration handling
document.addEventListener('DOMContentLoaded', () => {
    const ipv4Fields = document.querySelector('.ip-section:first-child .ip-fields');
    const ipv4Radio = {
        dhcp: document.getElementById('ipv4-dhcp'),
        manual: document.getElementById('ipv4-manual')
    };

    // Function to toggle IPv4 fields based on configuration type
    function toggleIPv4Fields() {
        const inputs = ipv4Fields.querySelectorAll('input[type="text"], input[type="number"]');
        const isManual = ipv4Radio.manual.checked;
        
        inputs.forEach(input => {
            input.disabled = !isManual;
        });
        
        ipv4Fields.classList.toggle('disabled', !isManual);

        // Also toggle route inputs
        const routeInputs = document.querySelectorAll('.route-input');
        routeInputs.forEach(input => {
            input.disabled = !isManual;
        });
    }

    // Add event listeners to radio buttons
    ipv4Radio.dhcp.addEventListener('change', toggleIPv4Fields);
    ipv4Radio.manual.addEventListener('change', toggleIPv4Fields);

    // Initial state setup
    toggleIPv4Fields();

    // Save network configuration
    document.getElementById('save-network').addEventListener('click', () => {
        const config = {
            ipv4: {
                mode: ipv4Radio.dhcp.checked ? 'dhcp' : 'manual',
                address: document.getElementById('ipv4-address').value,
                prefix: document.getElementById('ipv4-prefix').value,
                gateway: document.getElementById('ipv4-gateway').value,
                dns1: document.getElementById('ipv4-dns1').value,
                dns2: document.getElementById('ipv4-dns2').value,
                routes: [
                    {
                        destination: document.getElementById('route0-dest').value,
                        gateway: document.getElementById('route0-gateway').value,
                        metric: document.getElementById('route0-metric').value
                    },
                    {
                        destination: document.getElementById('route1-dest').value,
                        gateway: document.getElementById('route1-gateway').value,
                        metric: document.getElementById('route1-metric').value
                    }
                ]
            }
        };

        // Send configuration to server
        fetch('/save_network_config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Network configuration saved successfully');
            } else {
                alert('Failed to save network configuration: ' + data.message);
            }
        })
        .catch(error => {
            console.error('Error saving network configuration:', error);
            alert('Failed to save network configuration');
        });
    });

    // Clear network configuration
    document.getElementById('clear-network').addEventListener('click', () => {
        const inputs = document.querySelectorAll('.ip-fields input[type="text"], .ip-fields input[type="number"]');
        inputs.forEach(input => {
            input.value = '';
        });
        
        // Clear route inputs
        const routeInputs = document.querySelectorAll('.route-input');
        routeInputs.forEach(input => {
            input.value = '';
        });
        
        ipv4Radio.dhcp.checked = true;
        toggleIPv4Fields();
    });
});











function updateFilePath(input, displayId) {
    const display = document.getElementById(displayId);
    display.value = input.files.length > 0 ? input.files[0].name : '';
}



// // Function to replace with default certificate
// function replaceWithDefault() {
//     if (!confirm('Are you sure you want to replace the current SSL certificate with the default one? This action cannot be undone.')) {
//         return;
//     }

//     alert('Restoring default SSL certificate...');

//     fetch('/replace_ssl_default', {
//         method: 'POST'
//     })
//     .then(response => response.json())
//     .then(data => {
//         if (data.success) {
//             alert('Successfully restored default SSL certificate');
//             // Clear file inputs
//             document.getElementById('cert-file-display').value = '';
//             document.getElementById('key-file-display').value = '';
//             document.getElementById('cert-file').value = '';
//             document.getElementById('key-file').value = '';
//             // Update certificate information
//             updateCertificateInfo();
//         } else {
//             alert('Failed to restore default SSL certificate: ' + data.message);
//         }
//     })
//     .catch(error => {
//         console.error('Error:', error);
//         alert('Failed to restore default SSL certificate. Please check the console for details.');
//     });
// }



function importAndUseSSL() {
    console.log('Attempting to import SSL certificate...');
    
    const certInput = document.getElementById('cert-file');
    const keyInput = document.getElementById('key-file');
    const certFile = certInput.files[0];
    const keyFile = keyInput.files[0];

    // Validate file selection
    if (!certFile || !keyFile) {
        alert('Please select both certificate and key files');
        return;
    }

    // Validate file types
    const validCertExts = ['.crt', '.pem'];
    const validKeyExts = ['.key'];
    const certExt = certFile.name.toLowerCase().slice(certFile.name.lastIndexOf('.'));
    const keyExt = keyFile.name.toLowerCase().slice(keyFile.name.lastIndexOf('.'));

    if (!validCertExts.includes(certExt)) {
        alert('Invalid certificate file type. Please select a .crt or .pem file');
        return;
    }

    if (!validKeyExts.includes(keyExt)) {
        alert('Invalid key file type. Please select a .key file');
        return;
    }

    // Show loading message
    alert('Uploading SSL certificate and key files...');

    const formData = new FormData();
    formData.append('cert_file', certFile);
    formData.append('key_file', keyFile);

    fetch('/upload_ssl_files', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Successfully uploaded and configured SSL certificate');
            // Update certificate information
            updateCertificateInfo();
            // Clear file inputs
            document.getElementById('cert-file-display').value = '';
            document.getElementById('key-file-display').value = '';
            document.getElementById('cert-file').value = '';
            document.getElementById('key-file').value = '';
        } else {
            alert('Failed to upload SSL certificate: ' + data.message);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to upload SSL certificate. Please check the console for details.');
    });
}



// Initialize event listeners when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Set up file input handlers
    const certFile = document.getElementById('cert-file');
    const keyFile = document.getElementById('key-file');
    const certDisplay = document.getElementById('cert-file-display');
    const keyDisplay = document.getElementById('key-file-display');

    certFile.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            console.log('Certificate file selected:', file.name);
            certDisplay.value = file.name;
        } else {
            certDisplay.value = '';
        }
    });

    keyFile.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            console.log('Key file selected:', file.name);
            keyDisplay.value = file.name;
        } else {
            keyDisplay.value = '';
        }
    });

    // Load initial certificate information
    updateCertificateInfo();
});



function updateCertificateInfo() {
    fetch('/get_certificate_info')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const info = data.data;
                // Update the certificate details in the UI
                document.querySelector('.cert-details').innerHTML = `
                    <div class="info-row">
                        <label>Certificate issuer name:</label>
                        <span>${info.issuer_name}</span>
                    </div>
                    <div class="info-row">
                        <label>Certificate subject name:</label>
                        <span>${info.subject_name}</span>
                    </div>
                    <div class="info-row">
                        <label>Certificate effective timestamp:</label>
                        <span>${info.effective_timestamp}</span>
                    </div>
                    <div class="info-row">
                        <label>Certificate expiry timestamp:</label>
                        <span>${info.expiry_timestamp}</span>
                    </div>
                    <div class="info-row">
                        <label>Certificate blacklisted:</label>
                        <span>${info.blacklisted}</span>
                    </div>
                    <div class="info-row">
                        <label>Certificate self signed:</label>
                        <span>${info.is_self_signed}</span>
                    </div>
                    <div class="info-row">
                        <label>Certificate version:</label>
                        <span>${info.version}</span>
                    </div>
                `;
            } else {
                console.error('Failed to get certificate info:', data.message);
            }
        })
        .catch(error => {
            console.error('Error fetching certificate info:', error);
        });
}