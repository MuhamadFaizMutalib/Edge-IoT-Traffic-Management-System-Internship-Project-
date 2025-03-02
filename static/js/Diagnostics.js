async function fetchSystemData() {
    try {
        const response = await fetch('/api/system-data');
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching system data:', error);
        return null;
    }
}


function updateUI(data) {
    if (!data) return;

    // Helper function to safely update text content
    function safeUpdateText(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value || '-';
        }
    }

    // Update Block Status
    const blockStatus = data.blockStatus || {};
    safeUpdateText('type', blockStatus.type);
    safeUpdateText('version', blockStatus.version);
    safeUpdateText('serial', blockStatus.serialNumber);
    safeUpdateText('blockTime', blockStatus.currentBlockTime ? 
        new Date(blockStatus.currentBlockTime).toLocaleString() : '-');
    safeUpdateText('onlineSince', blockStatus.onlineSince ? 
        new Date(blockStatus.onlineSince).toLocaleString() : '-');
    safeUpdateText('uptime', blockStatus.uptime);

    // Update System Performance
    const sysPerf = data.systemPerformance || {};
    for (const [key, value] of Object.entries(sysPerf)) {
        safeUpdateText(key, value);
    }

    // Update Mount Points
    const mountPointsTable = document.getElementById('mountPointsTable');
    if (mountPointsTable && data.mountPoints) {
        mountPointsTable.innerHTML = data.mountPoints.map(point => `
            <tr>
                <td>${point.mountPoint || '-'}</td>
                <td>${point.devName || '-'}</td>
                <td>${point.used || '-'}</td>
                <td>${point.capacity || '-'}</td>
            </tr>
        `).join('') || '<tr><td colspan="4">No mount points available</td></tr>';
    }

    // Update Network Status
    const netStatus = data.networkStatus || {};
    safeUpdateText('internetAccess', netStatus.internetAccess);
    safeUpdateText('internetDelay', netStatus.internetDelay);
    safeUpdateText('dnsAccess', netStatus.dnsAccess);
    safeUpdateText('localVpn', netStatus.localVpn);
    safeUpdateText('serverVpn', netStatus.serverVpn);
    safeUpdateText('serverVpnPort', netStatus.serverVpnPort);

    // Update boolean values with appropriate styling
    ['internetAccess', 'dnsAccess', 'localVpn', 'serverVpn', 'serverVpnPort'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.className = 'value'; // Reset classes
            if (element.textContent === 'true') {
                element.classList.add('true');
            } else if (element.textContent === 'false') {
                element.classList.add('false');
            }
        }
    });

    // Update Network Interfaces
    const networkTable = document.getElementById('networkInterfacesTable');
    if (networkTable && netStatus.interfaces) {
        networkTable.innerHTML = netStatus.interfaces.map(iface => `
            <tr>
                <td>${iface.name || '-'}</td>
                <td>${iface.ipAddress || '-'}</td>
                <td>${iface.receive || '-'}</td>
                <td>${iface.totalReceived || '-'}</td>
                <td>${iface.transmit || '-'}</td>
                <td>${iface.totalTransmitted || '-'}</td>
            </tr>
        `).join('') || '<tr><td colspan="6">No network interfaces available</td></tr>';
    }
}


// Function to periodically update the data
async function startDataUpdates() {
    // Initial update
    const initialData = await fetchSystemData();
    if (initialData) {
        updateUI(initialData);
    }

    // Update every 2 seconds
    setInterval(async () => {
        const data = await fetchSystemData();
        if (data) {
            updateUI(data);
        }
    }, 2000);

    // Initial update
    updateSmartDiskStatus();

    // Update every 30 seconds
    setInterval(updateSmartDiskStatus, 30000);
}



function updateSmartDiskStatus() {
    const container = document.getElementById('smart-disk-status');
    if (!container) return;

    fetch('/api/smart-disk-status')
        .then(response => response.json())
        .then(data => {
            container.innerHTML = ''; // Clear existing content
            
            // Add disk usage information if available
            if (data.diskUsage && data.diskUsage.length > 0) {
                const diskUsage = data.diskUsage[0]; // Get root partition info
                const diskUsageCard = document.createElement('div');
                diskUsageCard.className = 'disk-card disk-usage-card';
                diskUsageCard.innerHTML = `
                    <div class="disk-header">
                        <strong>Disk Usage (${diskUsage.mountPoint})</strong>
                    </div>
                    <div class="disk-usage-table">
                        <table class="usage-table">
                            <thead>
                                <tr>
                                    <th>Size:</th>
                                    <th>Used:</th>
                                    <th>Available:</th>
                                    <th>Used%</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>${diskUsage.size}</td>
                                    <td>${diskUsage.used}</td>
                                    <td>${diskUsage.available}</td>
                                    <td>${diskUsage.usePercentage}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="usage-bar">
                        <div class="usage-fill" style="width: ${diskUsage.usePercentage};"></div>
                    </div>
                `;
                container.appendChild(diskUsageCard);
            }
            
            data.devices.forEach(device => {
                const diskCard = document.createElement('div');
                diskCard.className = 'disk-card';
                
                diskCard.innerHTML = `
                    <div class="disk-header">
                        <span class="health-indicator health-${device.health.toLowerCase()}"></span>
                        <strong>${device.name} (${device.model})</strong>
                    </div>
                    <div class="disk-info">
                        <div class="info-item">
                            <div class="info-label">Serial Number</div>
                            <div class="info-value">${device.serial}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Capacity</div>
                            <div class="info-value">${device.capacity}</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Temperature</div>
                            <div class="info-value">${device.temperature}°C</div>
                        </div>
                        <div class="info-item">
                            <div class="info-label">Power On Hours</div>
                            <div class="info-value">${device.powerOnHours} hours</div>
                        </div>
                    </div>
                    ${device.attributes.length > 0 ? `
                        <div style="padding: 0 20px 20px">
                            <table class="smart-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Attribute</th>
                                        <th>Value</th>
                                        <th>Worst</th>
                                        <th>Threshold</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${device.attributes.map(attr => `
                                        <tr>
                                            <td>${attr.id}</td>
                                            <td>${attr.name}</td>
                                            <td>${attr.value}</td>
                                            <td>${attr.worst}</td>
                                            <td>${attr.threshold}</td>
                                            <td>
                                                <span class="status-badge status-${attr.status.toLowerCase()}">
                                                    ${attr.status}
                                                </span>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : ''}
                `;
                
                container.appendChild(diskCard);
            });
        })
        .catch(error => {
            console.error('Error fetching disk status:', error);
            container.innerHTML = `
                <div style="color: #dc3545; padding: 20px;">
                    Error loading disk information: ${error.message}
                </div>
            `;
        });
}

// Start updating when the page loads
document.addEventListener('DOMContentLoaded', startDataUpdates);
