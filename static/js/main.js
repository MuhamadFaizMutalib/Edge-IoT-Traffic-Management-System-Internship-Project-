let activePanels = 0;
const maxPanels = 100;



function navigateToIndex() {
    window.location.href = "/index";
}

function openStreamConfiguration(streamId) {
    window.location.href = `/stream_configuration?streamId=${streamId}`;
}

function navigateToDiagnostics() {
    window.location.href = '/diagnostics';
}

function navigateToSettings() {
    window.location.href = "/block_settings";
}

function navigateToMyAccount() {
    window.location.href = "/MyAccount";
}

function logoutUser() {
    window.location.href = "/logout";
}



function toggleUserSubmenu() {
    const userSubmenu = document.getElementById('user-submenu');
    if (userSubmenu) {
        userSubmenu.style.display = userSubmenu.style.display === 'none' ? 'block' : 'none';
    }
}


function toggleBlockSubmenu() {
    const blockSubmenu = document.getElementById('block-submenu');
    if (blockSubmenu) {
        blockSubmenu.style.display = blockSubmenu.style.display === 'none' ? 'block' : 'none';
    }
}

function closeFullscreen() {
    const overlay = document.getElementById('fullscreenOverlay');
    overlay.style.display = 'none';
}


function toggleSourceList() {
const sourceList = document.getElementById('source-list');
sourceList.style.display = sourceList.style.display === 'none' ? 'block' : 'none';
}

function toggleBlockSubmenu() {
    const blockSubmenu = document.getElementById('block-submenu');
    blockSubmenu.style.display = blockSubmenu.style.display === 'none' ? 'block' : 'none';
}

function updateCameraCount() {
    fetch('/get_user_stream_count')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const countElement = document.querySelector('.camera-count');
                countElement.textContent = `${data.user_stream_count} / ${data.user_stream_count} cameras`;
            } else {
                console.error('Failed to fetch user-specific stream count:', data.message);
            }
        })
        .catch(error => console.error('Error fetching user-specific stream count:', error));
}





function createStream() {
    const createButton = document.querySelector('.create-btn');
    // Disable the button immediately to prevent multiple clicks
    createButton.disabled = true;
    createButton.style.backgroundColor = '#cccccc';
    createButton.textContent = 'Creating...';

    const analyticsName = document.getElementById('analyticsName').value;
    const rtspUrl = document.getElementById('rtspStream').value;

    if (!analyticsName || !rtspUrl) {
        alert('Please fill in all fields');
        // Re-enable the button if validation fails
        createButton.disabled = false;
        createButton.style.backgroundColor = '';
        createButton.textContent = 'Create';
        return;
    }

    fetch('/add_stream', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            analytics_name: analyticsName,
            rtsp_url: rtspUrl
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            closeModal();
            
            // Show loading state
            const modalContent = document.querySelector('.modal-content');
            modalContent.innerHTML = `
                <div class="loading-spinner-container" style="text-align: center; padding: 20px;">
                    <div class="loading-spinner" style="
                        width: 40px;
                        height: 40px;
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #3498db;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                        margin: 0 auto;
                    "></div>
                    <div class="loading-text" style="margin-top: 10px;">
                        Creating stream...
                    </div>
                </div>
            `;

            // Add the spinning animation style
            const style = document.createElement('style');
            style.textContent = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);

            // Call restart_streams
            fetch('/restart_streams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            .then(response => response.json())
            .catch(error => console.error('Error restarting streams:', error));

            // Wait for 5 seconds before reloading
            setTimeout(() => {
                window.location.reload();
            }, 5000);

        } else {
            alert('Error: ' + data.message);
            // Re-enable the button on error
            createButton.disabled = false;
            createButton.style.backgroundColor = '';
            createButton.textContent = 'Create';
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to create stream');
        // Re-enable the button on error
        createButton.disabled = false;
        createButton.style.backgroundColor = '';
        createButton.textContent = 'Create';
    });
}








// Add this to prevent form submission on Enter key
document.getElementById('analyticsName').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
    }
});

document.getElementById('rtspStream').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
    }
});




function openModal() {
    document.getElementById('createAnalyticsModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('createAnalyticsModal').style.display = 'none';
    document.getElementById('analyticsName').value = '';
    document.getElementById('rtspStream').value = '';
}


// Update the existing updateCameraPanel function
function updateCameraPanel(streamId, analyticsName) {
    const cameraGrid = document.querySelector('.camera-grid');
    
    const newPanel = document.createElement('div');
    newPanel.classList.add('camera-panel');
    newPanel.id = `panel-${streamId}`;
    newPanel.innerHTML = `
        <div class="camera-header">
            [${streamId}] ${analyticsName}
            <div class="dropdown">
                <button class="dots-btn" onclick="toggleDropdown(event)">
                    <i class="fa-solid fa-ellipsis-vertical" style="color: white;"></i>
                </button>
                <div class="dropdown-content">
                    <button onclick="showSetupModal(${streamId}, '${analyticsName}')">
                        <i class="fa-solid fa-gear"></i> Setup
                    </button>
                    <button onclick="deleteStream(${streamId})">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        </div>
        <div class="camera-feed" onclick="openStreamConfiguration('${streamId}')">
            <img src="/video_feed/${streamId}" alt="${analyticsName}" class="w-full h-full object-cover">
        </div>
    `;
    
    cameraGrid.appendChild(newPanel);
}



// //UPDATE ATAS
// {/* <button onclick="alert('Disable clicked')"><i class="fa-solid fa-ban"></i> Disable</button>
// <button onclick="alert('Statistics Alert clicked')"><i class="fa-solid fa-chart-column"></i> Statistics Alert</button>
// <button onclick="alert('Duplicate clicked')"><i class="fa-solid fa-clone"></i> Duplicate</button>
// <button onclick="alert('Clone Settings clicked')"><i class="fa-regular fa-clone"></i> Clone Settings</button>
// <button onclick="alert('Reset clicked')"><i class="fa-solid fa-arrows-rotate"></i> Reset</button> */}


// Update the JavaScript functions
function deleteStream(streamId) {
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog-overlay';
    dialog.innerHTML = `
        <div class="confirm-dialog">
            <h2>Are you sure you want to delete this stream?</h2>
            <div class="loading-spinner"></div>
            <div class="confirm-dialog-buttons">
                <button class="confirm-btn confirm-btn-yes">Yes, delete it</button>
                <button class="confirm-btn confirm-btn-no">No, keep it</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    const spinner = dialog.querySelector('.loading-spinner');
    const buttons = dialog.querySelector('.confirm-dialog-buttons');

    dialog.querySelector('.confirm-btn-no').addEventListener('click', () => {
        document.body.removeChild(dialog);
    });

    dialog.querySelector('.confirm-btn-yes').addEventListener('click', async () => {
        spinner.style.display = 'block';
        buttons.style.display = 'none';

        try {
            const response = await fetch('/delete_stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ stream_id: streamId })
            });

            const data = await response.json();

            // Add artificial delay for loading animation
            await new Promise(resolve => setTimeout(resolve, 10000));

            if (data.success) {
                window.location.reload();
            } else {
                alert(`Failed to delete stream: ${data.message}`);
                document.body.removeChild(dialog);
            }
        } catch (error) {
            console.error('Error deleting stream:', error);
            alert('An error occurred while deleting the stream.');
            document.body.removeChild(dialog);
        }
    });
}




    // Close the dropdown if the user clicks outside of it
    window.onclick = function(event) {
        const dropdowns = document.querySelectorAll('.dropdown-content');
        dropdowns.forEach(dropdown => {
            if (dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            }
        });
    }
// Initialize filter buttons
document.querySelectorAll('.filter-btn').forEach(button => {
    button.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        this.classList.add('active');
    });
});


function toggleDropdown(event) {
    event.stopPropagation();
    const dropdownContent = event.target.closest('.dropdown').querySelector('.dropdown-content');
    dropdownContent.style.display = dropdownContent.style.display === 'block' ? 'none' : 'block';
}

// Close the dropdown if the user clicks outside of it
window.onclick = function(event) {
    document.querySelectorAll('.dropdown-content').forEach(dropdown => {
        dropdown.style.display = 'none';
    });
};


function updateCameraCounter(totalStreams) {
    const counterElement = document.querySelector('.camera-count');
    counterElement.textContent = `${totalStreams} / ${totalStreams} cameras`;
}


// Modify your existing add stream function to include the counter update
async function addStream(rtspUrl, analyticsName) {
    try {
        const response = await fetch('/add_stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                rtsp_url: rtspUrl,
                analytics_name: analyticsName
            })
        });
        
        const data = await response.json();
        if (data.success) {
            // Add your existing stream creation code here
            
            // Update the camera counter
            updateCameraCounter(data.total_streams);
            
            return true;
        } else {
            console.error('Failed to add stream:', data.error);
            return false;
        }
    } catch (error) {
        console.error('Error adding stream:', error);
        return false;
    }
}


function fetchAndCreateStreams() {
    fetch('/get_streams')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const cameraGrid = document.querySelector('.camera-grid');
                cameraGrid.innerHTML = ''; // Clear existing content

                data.streams.forEach(stream => {
                    updateCameraPanel(stream.stream_id, stream.analytics_name);
                });

                updateCameraCount();
            } else {
                console.error('Failed to load streams:', data.message);
            }
        })
        .catch(error => console.error('Error fetching streams:', error));
}


// Combine all DOMContentLoaded functions into one
document.addEventListener('DOMContentLoaded', async () => {
    // Fetch and display the streams
    fetchAndCreateStreams();

    // Update the camera count for the logged-in user
    updateCameraCount();

    // Initialize the total stream count
    try {
        const response = await fetch('/get_user_stream_count');
        const data = await response.json();
        if (data.success) {
            updateCameraCounter(data.total_streams);
        }
    } catch (error) {
        console.error('Error fetching stream count:', error);
    }
});


document.addEventListener("DOMContentLoaded", () => {
    fetch('/check_session')
        .then(response => response.json())
        .then(data => {
            if (!data.loggedIn) {
                window.location.href = '/';
            }
        })
        .catch(error => {
            console.error('Session check failed:', error);
            window.location.href = '/';
        });

});



document.addEventListener('DOMContentLoaded', function() {
    const updateButton = document.querySelector('li:has(i.fa-sync-alt)');
    const updateModal = document.getElementById('updateModal');
    const okButton = document.getElementById('updateOkButton');

    if (updateButton && updateModal && okButton) {
        // Show modal when update button is clicked
        updateButton.addEventListener('click', function() {
            updateModal.style.display = 'flex';
        });

        // Hide modal when OK button is clicked
        okButton.addEventListener('click', function() {
            updateModal.style.display = 'none';
        });

        // Hide modal when clicking outside
        window.addEventListener('click', function(event) {
            if (event.target === updateModal) {
                updateModal.style.display = 'none';
            }
        });
    }
});




let currentStreamId = null; 


function showSetupModal(streamId, analyticsName) {
    currentStreamId = streamId;
    const modal = document.getElementById('setupAnalyticsModal');
    const nameInput = document.getElementById('setupName');
    const sourceInput = document.getElementById('setupSource');
    
    // Get the current stream settings
    fetch(`/get_stream_settings/${streamId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                nameInput.value = data.analytics_name;
                sourceInput.value = data.rtsp_url;
                modal.style.display = 'flex';
            } else {
                alert('Failed to get stream settings: ' + data.message);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Failed to get stream settings');
        });
}



function closeSetupModal() {
    const modal = document.getElementById('setupAnalyticsModal');
    modal.style.display = 'none';
    currentStreamId = null;
    document.getElementById('setupName').value = '';
    document.getElementById('setupSource').value = '';
}


function saveSetup() {
    if (!currentStreamId) return;
    
    const name = document.getElementById('setupName').value;
    const source = document.getElementById('setupSource').value;
    
    if (!name || !source) {
        alert('Please fill in all fields');
        return;
    }
    
    // Create overlay with loading spinner
    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay';
    overlay.innerHTML = `
        <div class="confirm-dialog">
            <h2>Updating stream settings...</h2>
            <div class="loading-spinner" style="
                display: block;
                width: 40px;
                height: 40px;
                margin: 20px auto;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #3498db;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
            <div style="margin-top: 20px; color: #666;">
                Please wait while the settings are being updated and streams are restarting...
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    fetch('/update_stream_settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            stream_id: currentStreamId,
            analytics_name: name,
            rtsp_url: source
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            closeSetupModal();
            
            // Call restart_streams
            return fetch('/restart_streams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        } else {
            throw new Error(data.message || 'Failed to update stream settings');
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Wait before reloading to allow streams to restart
            setTimeout(() => {
                window.location.reload();
            }, 5000);
        } else {
            throw new Error('Failed to restart streams');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        document.body.removeChild(overlay);
        alert(error.message || 'An error occurred while updating settings');
    });
}