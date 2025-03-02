document.addEventListener('DOMContentLoaded', function() {
    // Fetch terminal IP from server
    fetch('/get_terminal_ip')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const terminalIP = data.ip;
                document.getElementById('ipHidden').value = terminalIP;
                
                // Hide IP form and show login form
                document.getElementById('ipForm').style.display = 'none';
                document.getElementById('loginForm').style.display = 'block';
                
                // Verify the IP with the server
                return fetch('/check_ip', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ip_address: terminalIP }),
                });
            } else {
                throw new Error('Could not determine terminal IP');
            }
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                console.error('Terminal IP verification failed:', data.message);
            }
        })
        .catch(error => {
            console.error('Error during IP setup:', error);
        });
});



function validateAndConnect() {
    const ipInput = document.getElementById('ipInput');
    const ipError = document.getElementById('ipError');
    const ip = ipInput.value.trim();

    console.log("IP Entered:", ip);  // Log IP address

    if (!isValidIP(ip)) {
        console.log("Invalid IP format.");  // Log if IP is invalid
        ipError.textContent = "Please enter a valid IP address";
        ipError.style.display = 'block';
        return;
    }

    // Hide error message
    ipError.style.display = 'none';
    console.log("Fetching IP verification...");

    // Check if the IP exists in the database
    fetch('/check_ip', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ip_address: ip }),
    })
    .then(response => response.json())
    .then(data => {
        console.log("Response Data:", data);  // Log response from server
        if (data.success) {
            // Set the IP address in the hidden field for the login form
            document.getElementById('ipHidden').value = ip;

            // Show the login form if IP exists
            document.getElementById('ipForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
        } else {
            ipError.textContent = data.message;
            ipError.style.display = 'block';
        }
    })
    .catch(error => {
        console.error('Error checking IP:', error);  // Log any fetch errors
        ipError.textContent = 'Error verifying IP address. Please try again.';
        ipError.style.display = 'block';
    });
}




// Function to validate IP address format
function isValidIP(ip) {
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipPattern.test(ip)) return false;
    
    const parts = ip.split('.');
    return parts.every(part => {
        const num = parseInt(part, 10);
        return num >= 0 && num <= 255;
    });
}


// Function to show login form
function showLoginForm() {
    document.getElementById('ipForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
}

// Modal functions
function openModal() {
    document.getElementById('connectionModal').style.display = 'block';
}

function closeModal() {
    document.getElementById('connectionModal').style.display = 'none';
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('connectionModal');
    if (event.target === modal) {
        closeModal();
    }
}

// Handle Enter key in IP input
document.getElementById('ipInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        validateAndConnect();
    }
});

// Handle Enter key in login form
document.getElementById('password').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        handleLogin();
    }
});








