document.addEventListener('DOMContentLoaded', function() {
    fetchUserData();

    // Make fields editable on 'Edit' click
    document.querySelector('.edit-btn').addEventListener('click', function() {
        document.getElementById('username').disabled = false;
        document.getElementById('password').disabled = false;
    });

    // Save changes on 'Save' click
    document.querySelector('.save-btn').addEventListener('click', updateUserData);
});

// Fetch user data and populate fields
function fetchUserData() {
    fetch('/user_data')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('username').value = data.data.username;
                document.getElementById('password').value = ''; // leave password empty for security
            } else {
                console.error('Failed to fetch user data:', data.message);
            }
        })
        .catch(error => console.error('Error fetching user data:', error));
}

// Update user data
function updateUserData() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!username || !password) {
        alert('Username and password are required');
        return;
    }

    fetch('/update_user', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('User data updated successfully');
            document.getElementById('username').disabled = true;
            document.getElementById('password').disabled = true;
        } else {
            alert('Failed to update user data: ' + data.message);
        }
    })
    .catch(error => console.error('Error updating user data:', error));
}

