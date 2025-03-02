const streamId = document.getElementById('streamIdDisplay').textContent;
// Use `streamId` as needed in your logic

// Add these constants at the top of StreamConfig.js
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;


const interactionState = {
    activeElement: null, // 'line' or 'virtualLoop'
};

// Add a deletion queue to track items marked for deletion
const deletionState = {
    virtualLoops: new Set(),  // Store IDs of virtual loops to be deleted
    lineCrossings: new Set()  // Store IDs of line crossings to be deleted
};

// Add hover state tracking
const hoverState = {
    isNearCorner: false,
    nearestCorner: null,
    isNearEdge: false,
    nearestLoop: null
};


// Add the event listeners
const canvas = document.getElementById('virtualLoopCanvas');
canvas.removeEventListener('mousedown', handleMouseDown); // Remove existing listeners first
canvas.removeEventListener('mousemove', handleMouseMove);
canvas.removeEventListener('mouseup', handleMouseUp);

canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseup', handleMouseUp);



// Update the state to include dragging information
const virtualLoopState = {
    loops: [], // Start with an empty array of loops
    enabled: false,
    currentId: 0,
    isDragging: false,
    dragStartPos: null,
    selectedLoop: null
};


let isDragging = false;
let selectedLoop = null;
let selectedCorner = null;
let dragOffset = { x: 0, y: 0 };




// Function to add a new virtual loop to the canvas
function addVirtualLoop() {
    const newId = virtualLoopState.loops.length + 1; // Assign the next available ROI number
    const newLoop = {
        id: newId,
        corners: {
            x1y1: { x: 0.3, y: 0.3 },
            x2y2: { x: 0.3, y: 0.6 },
            x3y3: { x: 0.6, y: 0.6 },
            x4y4: { x: 0.6, y: 0.3 }
        },
        roiNumber: newId, // Set ROI number based on the length of existing loops
        selectedCorner: null,
        dragging: false,
        dragStart: null
    };

    virtualLoopState.loops.push(newLoop); // Add the new loop to the list

    // Redraw canvas to include the new loop
    const canvas = document.getElementById('virtualLoopCanvas');
    drawVirtualLoop(canvas.getContext('2d'));
    drawLineCrossings(canvas.getContext('2d'));
}




// Function to remove a virtual loop by index
function removeVirtualLoop(index) {
    virtualLoopState.loops.splice(index, 1); // Remove the loop from the array

    // Reassign ROI numbers to ensure they are sequential
    virtualLoopState.loops.forEach((loop, idx) => {
        loop.roiNumber = idx + 1; // Recalculate ROI numbers
    });

    // Redraw the canvas
    const canvas = document.getElementById('virtualLoopCanvas');
    drawVirtualLoop(canvas.getContext('2d'));
    drawLineCrossings(canvas.getContext('2d'));
}



function toggleVirtualLoop() {
    virtualLoopState.enabled = !virtualLoopState.enabled;
    const button = document.getElementById('virtualLoopBtn');
    const virtualLoopTab = document.getElementById('virtualLoopTab');
    const mainTab = document.getElementById('mainTab');

    button.classList.toggle('active');

    if (virtualLoopState.enabled) {
        virtualLoopTab.style.display = 'block';
        mainTab.style.display = 'none';
        initializeVirtualLoopTab();
    } else {
        virtualLoopTab.style.display = 'none';
        mainTab.style.display = 'block';
    }
}




// Add this to your initVirtualLoopCanvas function
function initVirtualLoopCanvas() {
    const canvas = document.getElementById('virtualLoopCanvas');
    const container = canvas.closest('.video-container');

    // Set canvas size to match container
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;

    // Load saved configurations
    loadConfigurations();

    // Add event listeners for mouse interactions
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('click', handleCanvasClick);
}

// Update the handleMouseDown function
function handleMouseDown(event) {
    if (event.button !== 0 || zoomState.isDragging) return;
    
    const coords = screenToCanvasCoordinates(event.clientX, event.clientY);
    const canvas = event.target;
    
    // Reset interaction state
    interactionState.activeElement = null;

    // Check virtual loop delete buttons
    let buttonClicked = false;
    virtualLoopState.loops.forEach((loop, index) => {
        if (loop.deleteButton && isPointInButton(coords.x, coords.y, loop.deleteButton)) {
            deleteVirtualLoop(index);
            buttonClicked = true;
            return;
        }
    });

    // Check line crossing delete buttons and name areas
    lineCrossingState.lines.forEach((line, index) => {
        if (line.xButton && isPointInButton(coords.x, coords.y, line.xButton)) {
            deleteLineCrossing(index);
            buttonClicked = true;
            return;
        }
        if (line.nameArea && isPointInButton(coords.x, coords.y, line.nameArea)) {
            startEditingLineName(line.id);
            buttonClicked = true;
            return;
        }
    });

    if (buttonClicked) {
        event.stopPropagation();
        return;
    }

    // Check for line crossing dragging
    const threshold = 0.02;
    let lineFound = false;

    lineCrossingState.lines.forEach(line => {
        // Check start point
        if (Math.hypot(line.start.x - coords.x, line.start.y - coords.y) < threshold) {
            interactionState.activeElement = 'line';
            lineCrossingState.draggingLine = line;
            lineCrossingState.draggingPoint = 'start';
            canvas.style.cursor = 'grab';
            lineFound = true;
            return;
        }
        
        // Check end point
        if (Math.hypot(line.end.x - coords.x, line.end.y - coords.y) < threshold) {
            interactionState.activeElement = 'line';
            lineCrossingState.draggingLine = line;
            lineCrossingState.draggingPoint = 'end';
            canvas.style.cursor = 'grab';
            lineFound = true;
            return;
        }
        
        // Check line itself
        const distanceToLine = pointToLineDistance(coords.x, coords.y, line.start, line.end);
        if (distanceToLine < threshold) {
            interactionState.activeElement = 'line';
            lineCrossingState.draggingLine = line;
            lineCrossingState.draggingPoint = 'line';
            canvas.style.cursor = 'move';
            lineFound = true;
            return;
        }
    });

    if (lineFound) {
        event.stopPropagation();
        return;
    }

    // If no line was clicked, check virtual loops
    virtualLoopState.loops.forEach(loop => {
        for (const corner in loop.corners) {
            const point = loop.corners[corner];
            const distance = Math.sqrt(
                Math.pow(coords.x - point.x, 2) + 
                Math.pow(coords.y - point.y, 2)
            );

            if (distance < threshold) {
                interactionState.activeElement = 'virtualLoop';
                virtualLoopState.isDragging = true;
                virtualLoopState.selectedLoop = loop;
                virtualLoopState.selectedCorner = corner;
                virtualLoopState.dragStartPos = coords;
                canvas.style.cursor = 'grabbing';
                return;
            }
        }

        if (isInsideVirtualLoop(coords.x, coords.y, loop)) {
            interactionState.activeElement = 'virtualLoop';
            virtualLoopState.isDragging = true;
            virtualLoopState.selectedLoop = loop;
            virtualLoopState.selectedCorner = null;
            virtualLoopState.dragStartPos = coords;
            canvas.style.cursor = 'move';
        }
    });
}


// Update the handleMouseMove function
function handleMouseMove(event) {
    if (!interactionState.activeElement || zoomState.isDragging) return;

    const coords = screenToCanvasCoordinates(event.clientX, event.clientY);
    const canvas = document.getElementById('virtualLoopCanvas');
    
    if (interactionState.activeElement === 'line' && lineCrossingState.draggingLine) {
        const line = lineCrossingState.draggingLine;
        
        if (lineCrossingState.draggingPoint === 'line') {
            // Moving the entire line
            const dx = coords.x - (line.start.x + line.end.x) / 2;
            const dy = coords.y - (line.start.y + line.end.y) / 2;
            
            line.start.x = Math.max(0, Math.min(1, line.start.x + dx));
            line.start.y = Math.max(0, Math.min(1, line.start.y + dy));
            line.end.x = Math.max(0, Math.min(1, line.end.x + dx));
            line.end.y = Math.max(0, Math.min(1, line.end.y + dy));
        } else {
            // Moving start or end point
            const point = lineCrossingState.draggingPoint;
            line[point].x = Math.max(0, Math.min(1, coords.x));
            line[point].y = Math.max(0, Math.min(1, coords.y));
        }
    } else if (interactionState.activeElement === 'virtualLoop') {
        handleVirtualLoopMouseMove(coords);
    }

    // Redraw
    const ctx = canvas.getContext('2d');
    drawVirtualLoop(ctx);
    drawLineCrossings(ctx);
}


// Update the handleMouseUp function
function handleMouseUp(event) {
    const canvas = event.target;
    
    if (interactionState.activeElement === 'line') {
        lineCrossingState.draggingLine = null;
        lineCrossingState.draggingPoint = null;
    } else if (interactionState.activeElement === 'virtualLoop') {
        virtualLoopState.isDragging = false;
        virtualLoopState.selectedLoop = null;
        virtualLoopState.selectedCorner = null;
        virtualLoopState.dragStartPos = null;
    }

    interactionState.activeElement = null;
    canvas.style.cursor = 'default';
}



// Optional: Add hover effects for better UX
function updateHoverState(event) {
    if (zoomState.isDragging || interactionState.activeElement) return;

    const coords = screenToCanvasCoordinates(event.clientX, event.clientY);
    const canvas = event.target;
    const threshold = 0.02;

    let isNearElement = false;

    // Check virtual loops
    virtualLoopState.loops.forEach(loop => {
        for (const corner in loop.corners) {
            const point = loop.corners[corner];
            const distance = Math.sqrt(
                Math.pow(coords.x - point.x, 2) + 
                Math.pow(coords.y - point.y, 2)
            );

            if (distance < threshold) {
                canvas.style.cursor = 'grab';
                isNearElement = true;
                return;
            }
        }

        if (isInsideVirtualLoop(coords.x, coords.y, loop)) {
            canvas.style.cursor = 'move';
            isNearElement = true;
        }
    });

    if (!isNearElement) {
        canvas.style.cursor = 'default';
    }
}


// Function to check if the mouse is over the delete button ("X")
function isMouseOverDeleteButton(mouseX, mouseY, loop) {
    const { x, y, width, height } = loop.deleteButton;
    return mouseX >= x && mouseX <= x + width && mouseY >= y && mouseY <= y + height;
}

// Function to check if the mouse is over the virtual loop box (for dragging)
function isMouseOverLoop(mouseX, mouseY, loop) {
    const corners = loop.corners;
    return (
        mouseX >= corners.x1y1.x && mouseX <= corners.x3y3.x &&
        mouseY >= corners.x1y1.y && mouseY <= corners.x3y3.y
    );
}


function handleCanvasClick(event) {
    // Get canvas coordinates
    const coords = screenToCanvasCoordinates(event.clientX, event.clientY);
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // If we're currently editing a name and click somewhere else, finish editing
    if (lineCrossingState.editingName !== null) {
        const input = document.querySelector('.line-name-input');
        if (input && !input.contains(event.target)) {
            finishEditingLineName(lineCrossingState.editingName, input.value);
            return;
        }
    }

    // Check line crossing name areas first
    for (const line of lineCrossingState.lines) {
        // Check name click area
        if (line.nameArea) {
            const area = line.nameArea;
            if (mouseX >= area.x && mouseX <= area.x + area.width &&
                mouseY >= area.y && mouseY <= area.y + area.height) {
                startEditingLineName(line.id);
                event.stopPropagation();
                return;
            }
        }

        // Check delete button
        if (line.xButton) {
            const button = line.xButton;
            if (mouseX >= button.x && mouseX <= button.x + button.width &&
                mouseY >= button.y && mouseY <= button.y + button.height) {
                const index = lineCrossingState.lines.findIndex(l => l.id === line.id);
                if (index !== -1) {
                    deleteLineCrossing(index);
                }
                event.stopPropagation();
                return;
            }
        }
    }

    // Check virtual loop delete buttons
    virtualLoopState.loops.forEach((loop, index) => {
        const button = loop.deleteButton;
        if (button && 
            mouseX >= button.x && mouseX <= button.x + button.width &&
            mouseY >= button.y && mouseY <= button.y + button.height) {
            deleteVirtualLoop(index);
            event.stopPropagation();
            return;
        }
    });

    // Handle other canvas interactions if no buttons were clicked
    if (!interactionState.activeElement) {
        // Check if clicking to start drawing a new virtual loop or line crossing
        if (virtualLoopState.enabled) {
            // Handle virtual loop creation logic here if needed
        } else if (lineCrossingState.enabled) {
            // Handle line crossing creation logic here if needed
        }
    }

    // Reset states if clicking empty canvas area
    virtualLoopState.selectedLoop = null;
    virtualLoopState.selectedCorner = null;
    lineCrossingState.draggingLine = null;
    lineCrossingState.draggingPoint = null;

    // Redraw canvas
    const ctx = canvas.getContext('2d');
    drawVirtualLoop(ctx);
    drawLineCrossings(ctx);
}




// Helper function to check if a point is inside a button area
function isPointInButton(x, y, button) {
    return button && 
           x >= button.x && x <= button.x + button.width &&
           y >= button.y && y <= button.y + button.height;
}

// Helper function to check if a point is inside a text area
function isPointInTextArea(x, y, area) {
    return area &&
           x >= area.x && x <= area.x + area.width &&
           y >= area.y && y <= area.y + area.height;
}



// Function to draw virtual loops
function drawVirtualLoop(ctx) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawGrid(ctx);

    ctx.save();
    
    virtualLoopState.loops.forEach((loop, index) => {
        if (!loop.corners) return; // Skip if corners are undefined

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.lineWidth = 2;
        
        let firstPoint = true;
        let centerX = 0, centerY = 0, cornerCount = 0;

        for (const corner in loop.corners) {
            const point = loop.corners[corner];
            if (!point) continue; // Skip undefined points

            const x = point.x * ctx.canvas.width;
            const y = point.y * ctx.canvas.height;

            centerX += x;
            centerY += y;
            cornerCount++;

            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }

        if (cornerCount > 0) {
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
            ctx.fill();

            centerX /= cornerCount;
            centerY /= cornerCount;

            // Draw ROI number
            ctx.fillStyle = '#00FF00';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`ROI ${loop.roiNumber}`, centerX, centerY - 8); // Moved up slightly to make room for X button

            // Draw X button for deletion (similar to line crossing style)
            ctx.fillStyle = '#FF0000';
            ctx.textAlign = 'center';
            const xButtonX = centerX;
            const xButtonY = centerY + 8; // Positioned below ROI number
            ctx.fillText('X', xButtonX, xButtonY); // Using × symbol for better appearance

            // Store delete button position with adjusted coordinates
            loop.deleteButton = {
                x: xButtonX - 8,
                y: xButtonY - 12,
                width: 16,
                height: 16
            };

            // Draw corner handles
            drawCornerHandles(ctx, loop);
        }
    });

    ctx.restore();
}



// Update deleteVirtualLoop function
function deleteVirtualLoop(index) {
    const loop = virtualLoopState.loops[index];
    if (loop) {
        // Add to deletion queue
        deletionState.virtualLoops.add(loop.roiNumber);
        // Remove from UI
        virtualLoopState.loops.splice(index, 1);
        
        // Recalculate ROI numbers for ALL remaining loops
        virtualLoopState.loops.forEach((remainingLoop, idx) => {
            remainingLoop.roiNumber = idx + 1; // Reassign ROI numbers sequentially
            remainingLoop.id = idx + 1; // Update ID to match new ROI number
        });
        
        // Update UI
        const canvas = document.getElementById('virtualLoopCanvas');
        drawVirtualLoop(canvas.getContext('2d'));
        drawLineCrossings(canvas.getContext('2d'));
    }
}




// Update deleteLineCrossing function
function deleteLineCrossing(index) {
    const line = lineCrossingState.lines[index];
    if (line) {
        // Add to deletion queue
        deletionState.lineCrossings.add(line.id);
        // Remove from UI
        lineCrossingState.lines.splice(index, 1);
        // Update UI
        const canvas = document.getElementById('virtualLoopCanvas');
        drawVirtualLoop(canvas.getContext('2d'));
        drawLineCrossings(canvas.getContext('2d'));
    }
}


function updateROINumbers() {
    virtualLoopState.loops.forEach((loop, index) => {
        loop.roiNumber = index + 1; // Update ROI numbers
    });
}



function drawGrid(ctx) {
    const gridSize = 20;
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
    ctx.lineWidth = 1;

    for (let x = 0; x < ctx.canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ctx.canvas.height);
        ctx.stroke();
    }

    for (let y = 0; y < ctx.canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(ctx.canvas.width, y);
        ctx.stroke();
    }
}



// Update the threshold calculation in handleVirtualLoopMouseDown
function handleVirtualLoopMouseDown(event) {
    const coords = screenToCanvasCoordinates(event.clientX, event.clientY);
    const canvas = event.target;
    
    // Adjust threshold based on zoom level
    const zoomContainer = document.querySelector('.zoom-container');
    const matrix = new DOMMatrix(window.getComputedStyle(zoomContainer).transform);
    const scale = matrix.a;
    const threshold = 0.02 * (1 / scale);  // Adjust threshold based on zoom level

    virtualLoopState.loops.forEach(loop => {
        // Check corners first
        for (const corner in loop.corners) {
            const point = loop.corners[corner];
            const distance = Math.sqrt(
                Math.pow(coords.x - point.x, 2) + 
                Math.pow(coords.y - point.y, 2)
            );

            if (distance < threshold) {
                virtualLoopState.isDragging = true;
                virtualLoopState.selectedLoop = loop;
                virtualLoopState.selectedCorner = corner;
                virtualLoopState.dragStartPos = coords;
                canvas.style.cursor = 'grabbing';
                return;
            }
        }

        // Check if inside loop
        if (isInsideVirtualLoop(coords.x, coords.y, loop)) {
            virtualLoopState.isDragging = true;
            virtualLoopState.selectedLoop = loop;
            virtualLoopState.selectedCorner = null;
            virtualLoopState.dragStartPos = coords;
            canvas.style.cursor = 'move';
        }
    });
}



// Update handleVirtualLoopMouseMove function
function handleVirtualLoopMouseMove(event) {
    if (!virtualLoopState.isDragging || !virtualLoopState.selectedLoop) return;
    
    const coords = screenToCanvasCoordinates(event.clientX, event.clientY);
    const canvas = document.getElementById('virtualLoopCanvas');
    
    if (virtualLoopState.selectedCorner) {
        // Moving a corner
        virtualLoopState.selectedLoop.corners[virtualLoopState.selectedCorner] = {
            x: Math.max(0, Math.min(1, coords.x)),
            y: Math.max(0, Math.min(1, coords.y))
        };
    } else {
        // Moving the entire loop
        const dx = coords.x - virtualLoopState.dragStartPos.x;
        const dy = coords.y - virtualLoopState.dragStartPos.y;
        
        for (const corner in virtualLoopState.selectedLoop.corners) {
            const point = virtualLoopState.selectedLoop.corners[corner];
            point.x = Math.max(0, Math.min(1, point.x + dx));
            point.y = Math.max(0, Math.min(1, point.y + dy));
        }
        virtualLoopState.dragStartPos = coords;
    }
    
    // Redraw
    const ctx = canvas.getContext('2d');
    drawVirtualLoop(ctx);
    drawLineCrossings(ctx);
}





function drawCornerHandles(ctx, loop) {
    ctx.fillStyle = '#00ff00';
    ctx.strokeStyle = '#008800';
    ctx.lineWidth = 2;

    for (const corner in loop.corners) {
        const point = loop.corners[corner];
        const x = point.x * ctx.canvas.width;
        const y = point.y * ctx.canvas.height;

        // Draw smaller corner handle (reduced from 8 to 5 to match line crossing style)
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Add highlight effect if mouse is near (reduced from 12 to 8)
        if (hoverState.isNearCorner && hoverState.nearestCorner === corner && hoverState.nearestLoop === loop) {
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.strokeStyle = '#00ff00';
            ctx.stroke();
        }
    }
}





function handleVirtualLoopMouseUp(event) {
    virtualLoopState.loops.forEach((loop) => {
        loop.dragging = false;
        loop.selectedCorner = null;
        loop.dragStart = null;
        loop.dragStartCorners = null;
    });

    const canvas = event.target;
    canvas.style.cursor = 'default';
}




function updateCursor(canvas, x, y) {
    const threshold = 0.02;
    let cursorSet = false;

    // Check corners
    for (const corner in virtualLoopState.corners) {
        const point = virtualLoopState.corners[corner];
        const distance = Math.sqrt(
            Math.pow(x - point.x, 2) + 
            Math.pow(y - point.y, 2)
        );

        if (distance < threshold) {
            canvas.style.cursor = 'grab';
            cursorSet = true;
            break;
        }
    }

    if (!cursorSet) {
        canvas.style.cursor = isInsideVirtualLoop(x, y) ? 'move' : 'default';
    }
}


// Helper function to check if a point is inside the virtual loop
function isInsideVirtualLoop(x, y, loop) {
    let inside = false;
    const corners = [
        loop.corners.x1y1,
        loop.corners.x2y2,
        loop.corners.x3y3,
        loop.corners.x4y4
    ];

    for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
        const xi = corners[i].x, yi = corners[i].y;
        const xj = corners[j].x, yj = corners[j].y;

        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}



function updateVirtualLoopCoordinates() {
    const coordsDiv = document.getElementById('virtualLoopCoordinates');
    let coordsText = '';
    
    for (const corner in virtualLoopState.corners) {
        const point = virtualLoopState.corners[corner];
        const x = Math.round(point.x * 1280);
        const y = Math.round(point.y * 720);
        coordsText += `${corner}: ${x};${y}\n`;
    }
    
    coordsDiv.textContent = coordsText;
}




// Update saveVirtualLoop function
async function saveVirtualLoop() {
    const streamId = parseInt(document.getElementById('streamIdDisplay').textContent, 10);
    const streamNumber = Math.max(0, streamId - 1);

    try {
        // Map loops ensuring ROI numbers are sequential
        const loopsData = virtualLoopState.loops.map((loop, index) => ({
            rfNumber: index + 1, // Use index+1 instead of loop.roiNumber
            coordinates: loop.corners
        }));

        const response = await fetch('/save_virtual_loop', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                streamNumber: streamNumber,
                loops: loopsData,
                deletedLoops: Array.from(deletionState.virtualLoops)
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.success) {
            deletionState.virtualLoops.clear();
            return true;
        }
        throw new Error(data.message || 'Failed to save virtual loop configuration');
    } catch (error) {
        console.error('Error saving virtual loop:', error);
        throw error;
    }
}



async function saveLineCrossing() {
    const streamId = parseInt(document.getElementById('streamIdDisplay').textContent, 10);
    const streamNumber = Math.max(0, streamId - 1);

    try {
        const lineCrossingData = lineCrossingState.lines.map((line, index) => {
            // Calculate center point
            const centerX = (line.start.x + line.end.x) / 2;
            const centerY = (line.start.y + line.end.y) / 2;
            
            // Calculate direction vectors
            const dx = line.end.x - line.start.x;
            const dy = line.end.y - line.start.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const normalizedDx = dx / length;
            const normalizedDy = dy / length;
            
            // Calculate perpendicular vector (for arrow)
            const perpDx = normalizedDy;
            const perpDy = -normalizedDx;
            
            // Arrow parameters (scaled for 1280x720)
            const arrowLength = 40 / 1280; // Scale to normalized coordinates
            
            // Calculate arrow points
            const arrowTopX1 = centerX - perpDx * arrowLength;
            const arrowTopY1 = centerY - perpDy * arrowLength;
            const arrowTopX2 = centerX + perpDx * arrowLength;
            const arrowTopY2 = centerY + perpDy * arrowLength;
            
            // Convert to pixel coordinates
            const leftEdgeX = Math.round(line.start.x * 1280);
            const leftEdgeY = Math.round(line.start.y * 720);
            const rightEdgeX = Math.round(line.end.x * 1280);
            const rightEdgeY = Math.round(line.end.y * 720);
            const arrowX1 = Math.round(arrowTopX1 * 1280);
            const arrowY1 = Math.round(arrowTopY1 * 720);
            const arrowX2 = Math.round(arrowTopX2 * 1280);
            const arrowY2 = Math.round(arrowTopY2 * 720);

            return {
                number: index + 1,
                name: line.name || `Line_Name ${index + 1}`,
                coordinates: `${arrowX2};${arrowY2};${arrowX1};${arrowY1};${leftEdgeX};${leftEdgeY};${rightEdgeX};${rightEdgeY}`
            };
        });

        const response = await fetch('/save_line_crossing', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                streamNumber: streamNumber,
                lineCrossings: lineCrossingData,
                deletedLines: Array.from(deletionState.lineCrossings)
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.success) {
            deletionState.lineCrossings.clear();
            return true;
        }
        throw new Error(data.message || 'Failed to save line crossing configuration');
    } catch (error) {
        console.error('Error saving line crossing:', error);
        throw error;
    }
}


//////////////////////MATA-MATA/////////////////////////////////


// Add this at the end of StreamConfig.js
document.addEventListener('DOMContentLoaded', () => {
    const applyButton = document.getElementById('SaveConfiguration');
    if (applyButton) {
        applyButton.addEventListener('click', handleSaveClick);
        console.log('Apply button listener added'); // Debug log
    } else {
        console.error('Apply button not found');
    }
});


async function handleSaveClick() {
    const saveButton = document.querySelector('#SaveConfiguration');
    if (!saveButton) {
        console.error('Save button not found');
        return;
    }

    const originalText = saveButton.textContent;
    saveButton.textContent = 'Saving...';
    saveButton.disabled = true;

    try {
        let saveResults = [];
        let messages = [];

        // Save virtual loops if they exist or if there are deletions pending
        if (virtualLoopState.loops.length > 0 || deletionState.virtualLoops.size > 0) {
            try {
                const virtualLoopSuccess = await saveVirtualLoop();
                saveResults.push(virtualLoopSuccess);
                messages.push(virtualLoopSuccess ? 
                    'Virtual Detector saved successfully' : 
                    'Failed to save Virtual Detector');
            } catch (error) {
                console.error('Error saving virtual loops:', error);
                saveResults.push(false);
                messages.push(`Virtual Detector error: ${error.message}`);
            }
        }

        // Save line crossings if they exist or if there are deletions pending
        if (lineCrossingState.lines.length > 0 || deletionState.lineCrossings.size > 0) {
            try {
                const lineCrossingSuccess = await saveLineCrossing();
                saveResults.push(lineCrossingSuccess);
                messages.push(lineCrossingSuccess ? 
                    'Line Crossing saved successfully' : 
                    'Failed to save Line Crossing');
            } catch (error) {
                console.error('Error saving line crossings:', error);
                saveResults.push(false);
                messages.push(`Line Crossing error: ${error.message}`);
            }
        }

        // Handle results
        const allSuccessful = saveResults.every(result => result === true);
        
        if (allSuccessful) {
            alert('All configurations saved successfully');
            document.getElementById('virtualLoopTab').style.display = 'none';
            document.getElementById('mainTab').style.display = 'block';
            
            // Add the loading process here
            const mainTab = document.getElementById('mainTab');
            const currentImage = document.getElementById('streamImage');
            const streamUrl = currentImage ? currentImage.src : '';
            
            // Update mainTab with loading spinner
            mainTab.innerHTML = `
                <div class="video-container">
                    <div class="loading-spinner-container">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">Loading stream...</div>
                    </div>
                    <img src="${streamUrl}" id="streamImage" alt="Stream" style="display: none;">
                </div>
                <div class="controls-container">
                    <button id="virtualLoopBtn" onclick="toggleVirtualLoop()" class="control-btn">
                        <i class="fa-solid fa-gear"></i>
                        Settings
                    </button>
                    <button id="enableNvdsAnalyticBtn" onclick="enableNvdsAnalytic()" class="control-btn">
                        <i class="fa-solid fa-play"></i>
                        Nvds-Analytic
                    </button>
                </div>
            `;

            // Call restart_streams endpoint
            fetch('/restart_streams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            }).then(response => response.json())
              .catch(error => console.error('Error restarting streams:', error));

            // Handle loading spinner timeout
            setTimeout(() => {
                const loadingSpinner = document.querySelector('.loading-spinner-container');
                const streamImage = document.getElementById('streamImage');
                
                if (loadingSpinner) {
                    loadingSpinner.classList.add('fade-out');
                    setTimeout(() => {
                        loadingSpinner.remove();
                        if (streamImage) {
                            streamImage.style.display = 'block';
                        }
                    }, 300);
                }
            }, 15000);  // 10 second timeout for loading

        } else {
            alert('Save operation completed with issues:\n' + messages.join('\n'));
        }
    } catch (error) {
        console.error('Error in save operation:', error);
        alert(`An error occurred while saving configurations: ${error.message}`);
    } finally {
        saveButton.textContent = originalText;
        saveButton.disabled = false;
    }
}



// Helper function to validate coordinates
function validateCoordinates(coords) {
    if (!coords) return false;
    
    const required = ['x1y1', 'x2y2', 'x3y3', 'x4y4'];
    return required.every(key => {
        return coords[key] && 
               typeof coords[key].x === 'number' && 
               typeof coords[key].y === 'number' &&
               coords[key].x >= 0 && coords[key].x <= 1 &&
               coords[key].y >= 0 && coords[key].y <= 1;
    });
}




function enableNvdsAnalytic() {
    fetch('/toggle_nvds_analytic', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert(data.message);
                console.log(data.message);
                
                // Add loading stream functionality
                const mainTab = document.getElementById('mainTab');
                const currentImage = document.getElementById('streamImage');
                const streamUrl = currentImage ? currentImage.src : '';
                
                // Update mainTab with loading spinner
                mainTab.innerHTML = `
                    <div class="video-container">
                        <div class="loading-spinner-container">
                            <div class="loading-spinner"></div>
                            <div class="loading-text">Loading stream...</div>
                        </div>
                        <img src="${streamUrl}" id="streamImage" alt="Stream" style="display: none;">
                    </div>
                    <div class="controls-container">
                        <button id="virtualLoopBtn" onclick="toggleVirtualLoop()" class="control-btn">
                            <i class="fa-solid fa-gear"></i>
                            Settings
                        </button>
                        <button id="enableNvdsAnalyticBtn" onclick="enableNvdsAnalytic()" class="control-btn">
                            <i class="fa-solid fa-play"></i>
                            Nvds-Analytic
                        </button>
                    </div>
                `;

                // Call restart_streams endpoint
                fetch('/restart_streams', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }).then(response => response.json())
                  .catch(error => console.error('Error restarting streams:', error));

                // Handle loading spinner timeout
                setTimeout(() => {
                    const loadingSpinner = document.querySelector('.loading-spinner-container');
                    const streamImage = document.getElementById('streamImage');
                    
                    if (loadingSpinner) {
                        loadingSpinner.classList.add('fade-out');
                        setTimeout(() => {
                            loadingSpinner.remove();
                            if (streamImage) {
                                streamImage.style.display = 'block';
                            }
                        }, 300);
                    }
                }, 15000);  // 10 second timeout for loading

            } else {
                alert(`Error: ${data.message}`);
                console.error(data.message);
            }
        })
        .catch(error => {
            alert('An error occurred while toggling Nvds-Analytic.');
            console.error(error);
        });
}


function cancelVirtualLoop() {
    const virtualLoopTab = document.getElementById('virtualLoopTab');
    const mainTab = document.getElementById('mainTab');

    // Hide Virtual Loop Tab and show Main Tab
    virtualLoopTab.style.display = 'none';
    mainTab.style.display = 'block';

    // Optional: Reset any unsaved changes or form inputs if needed
    console.log('Virtual Loop canceled. Returning to Main Tab.');
}


// Update handleLineCrossingMouseDown function
function handleLineCrossingMouseDown(event) {
    const coords = screenToCanvasCoordinates(event.clientX, event.clientY);
    const threshold = 0.02;
    
    lineCrossingState.lines.forEach(line => {
        if (Math.hypot(line.start.x - coords.x, line.start.y - coords.y) < threshold) {
            lineCrossingState.draggingLine = line;
            lineCrossingState.draggingPoint = 'start';
        } else if (Math.hypot(line.end.x - coords.x, line.end.y - coords.y) < threshold) {
            lineCrossingState.draggingLine = line;
            lineCrossingState.draggingPoint = 'end';
        } else if (pointToLineDistance(coords.x, coords.y, line.start, line.end) < threshold) {
            lineCrossingState.draggingLine = line;
            lineCrossingState.draggingPoint = 'line';
        }
    });
}

// Update handleLineCrossingMouseMove function
function handleLineCrossingMouseMove(event) {
    if (!lineCrossingState.draggingLine) return;
    
    const coords = screenToCanvasCoordinates(event.clientX, event.clientY);
    const line = lineCrossingState.draggingLine;
    
    if (lineCrossingState.draggingPoint === 'line') {
        const dx = coords.x - (line.start.x + line.end.x) / 2;
        const dy = coords.y - (line.start.y + line.end.y) / 2;
        line.start.x += dx;
        line.start.y += dy;
        line.end.x += dx;
        line.end.y += dy;
    } else {
        line[lineCrossingState.draggingPoint] = {
            x: Math.max(0, Math.min(1, coords.x)),
            y: Math.max(0, Math.min(1, coords.y))
        };
    }
    
    const canvas = document.getElementById('virtualLoopCanvas');
    const ctx = canvas.getContext('2d');
    drawLineCrossings(ctx);
}


// Update the threshold calculation in isNearVirtualLoopElements
function isNearVirtualLoopElements(x, y, canvas) {
    // Adjust threshold based on zoom level
    const zoomContainer = document.querySelector('.zoom-container');
    const matrix = new DOMMatrix(window.getComputedStyle(zoomContainer).transform);
    const scale = matrix.a;
    
    // Base thresholds adjusted by zoom scale
    const cornerThreshold = 0.015 * (1 / scale); // Smaller base value, adjusted for zoom
    const edgeThreshold = 0.01 * (1 / scale);   // Smaller base value, adjusted for zoom
    
    for (const loop of virtualLoopState.loops) {
        // Check corners first with adjusted threshold
        for (const corner in loop.corners) {
            const point = loop.corners[corner];
            const distance = Math.sqrt(
                Math.pow(x - point.x, 2) + 
                Math.pow(y - point.y, 2)
            );
            
            if (distance < cornerThreshold) {
                hoverState.isNearCorner = true;
                hoverState.nearestCorner = corner;
                hoverState.nearestLoop = loop;
                return true;
            }
        }
        
        // Check edges with adjusted threshold
        const corners = [
            loop.corners.x1y1,
            loop.corners.x2y2,
            loop.corners.x3y3,
            loop.corners.x4y4,
            loop.corners.x1y1
        ];

        for (let i = 0; i < corners.length - 1; i++) {
            const start = corners[i];
            const end = corners[i + 1];
            const distanceToEdge = pointToLineDistance(x, y, start, end);

            if (distanceToEdge < edgeThreshold) {
                hoverState.isNearEdge = true;
                hoverState.nearestLoop = loop;
                return true;
            }
        }
        
        if (isInsideVirtualLoop(x, y, loop)) {
            hoverState.nearestLoop = loop;
            return true;
        }
    }

    // Reset hover state if not near any elements
    hoverState.isNearCorner = false;
    hoverState.nearestCorner = null;
    hoverState.isNearEdge = false;
    hoverState.nearestLoop = null;
    return false;
}






// Function to check if point is near line crossing elements
function isNearLineCrossingElements(x, y, canvas) {
    const threshold = 0.02;
    
    for (const line of lineCrossingState.lines) {
        // Check start and end points
        if (Math.hypot(line.start.x - x, line.start.y - y) < threshold ||
            Math.hypot(line.end.x - x, line.end.y - y) < threshold) {
            return true;
        }

        // Check arrow tip
        const centerX = (line.start.x + line.end.x) / 2;
        const centerY = (line.start.y + line.end.y) / 2;
        const angle = line.angle || Math.PI/2;
        const arrowLength = 40 / canvas.width;
        const arrowTipX = centerX + Math.cos(angle) * arrowLength;
        const arrowTipY = centerY + Math.sin(angle) * arrowLength;
        
        if (Math.hypot(arrowTipX - x, arrowTipY - y) < threshold) {
            return true;
        }

        // Check line itself
        if (pointToLineDistance(x, y, line.start, line.end) < threshold) {
            return true;
        }
    }
    return false;
}


const lineCrossingState = {
    lines: [], // Store all line crossings
    draggingLine: null,
    draggingPoint: null,
    editingName: null // Track which line is being edited
};



let isLineDragging = false;
let selectedLine = null;



function addLineCrossing() {
    const canvas = document.getElementById('virtualLoopCanvas');
    const ctx = canvas.getContext('2d');

    const newLine = {
        id: lineCrossingState.lines.length + 1,
        name: 'Line_Name',  // Add default name here
        start: { x: 0.3, y: 0.5 },
        end: { x: 0.7, y: 0.5 }
    };

    lineCrossingState.lines.push(newLine);
    drawLineCrossings(ctx);
}

// Add function to handle name editing
function startEditingLineName(lineId) {
    const canvas = document.getElementById('virtualLoopCanvas');
    const ctx = canvas.getContext('2d');
    
    // Create input element
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'line-name-input';
    const line = lineCrossingState.lines.find(l => l.id === lineId);
    input.value = line.name || 'Line_Name';  // Change default here
    
    // Position input over the line name
    const centerX = (line.start.x + line.end.x) / 2;
    const centerY = (line.start.y + line.end.y) / 2;
    const rect = canvas.getBoundingClientRect();
    
    input.style.position = 'absolute';
    input.style.left = `${rect.left + centerX * canvas.width - 40}px`;
    input.style.top = `${rect.top + centerY * canvas.height - 25}px`;
    input.style.width = '80px';
    input.style.zIndex = '1000';
    
    document.body.appendChild(input);
    input.focus();
    input.select();
    
    input.onblur = () => finishEditingLineName(lineId, input.value);
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            input.value = line.name || 'Line_Name';  // Change default here
            input.blur();
        }
    };
    
    lineCrossingState.editingName = lineId;
}


// Function to finish editing name
function finishEditingLineName(lineId, newName) {
    const line = lineCrossingState.lines.find(l => l.id === lineId);
    if (line) {
        line.name = newName.trim() || 'Line_Name';  // Change default here
    }
    lineCrossingState.editingName = null;
    
    const input = document.querySelector('.line-name-input');
    if (input) {
        input.remove();
    }
    
    const canvas = document.getElementById('virtualLoopCanvas');
    const ctx = canvas.getContext('2d');
    drawVirtualLoop(ctx);
    drawLineCrossings(ctx);
}

// Helper function to check if mouse is over an area
function isMouseOverArea(mouseX, mouseY, area) {
    return mouseX >= area.x && 
           mouseX <= area.x + area.width && 
           mouseY >= area.y && 
           mouseY <= area.y + area.height;
}

function drawLineCrossings(ctx) {
    // Clear canvas and redraw virtual loops first
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawVirtualLoop(ctx);

    // Draw each line crossing
    lineCrossingState.lines.forEach((line, index) => {
        const startX = line.start.x * ctx.canvas.width;
        const startY = line.start.y * ctx.canvas.height;
        const endX = line.end.x * ctx.canvas.width;
        const endY = line.end.y * ctx.canvas.height;

        // Draw the main line
        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Draw endpoints
        ctx.fillStyle = '#00FF00';
        ctx.beginPath();
        ctx.arc(startX, startY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(endX, endY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Calculate center point and arrow parameters
        const centerX = (startX + endX) / 2;
        const centerY = (startY + endY) / 2;

        // Calculate direction vectors
        const dx = endX - startX;
        const dy = endY - startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const normalizedDx = dx / length;
        const normalizedDy = dy / length;
        const perpDx = -normalizedDy;
        const perpDy = normalizedDx;

        // Arrow parameters
        const arrowLength = 40;
        const arrowHeadLength = arrowLength * 0.3;
        const headAngle = Math.PI / 6; // 30 degrees

        // Draw arrow
        const arrowStartX = centerX;
        const arrowStartY = centerY;
        const arrowTipX = centerX + perpDx * arrowLength;
        const arrowTipY = centerY + perpDy * arrowLength;

        // Draw arrow shaft
        ctx.beginPath();
        ctx.moveTo(arrowStartX, arrowStartY);
        ctx.lineTo(arrowTipX, arrowTipY);
        ctx.stroke();

        // Calculate and draw arrowhead
        const arrowLeft = {
            x: arrowTipX - arrowHeadLength * (perpDx * Math.cos(headAngle) - perpDy * Math.sin(headAngle)),
            y: arrowTipY - arrowHeadLength * (perpDx * Math.sin(headAngle) + perpDy * Math.cos(headAngle))
        };
        
        const arrowRight = {
            x: arrowTipX - arrowHeadLength * (perpDx * Math.cos(-headAngle) - perpDy * Math.sin(-headAngle)),
            y: arrowTipY - arrowHeadLength * (perpDx * Math.sin(-headAngle) + perpDy * Math.cos(-headAngle))
        };

        ctx.beginPath();
        ctx.moveTo(arrowTipX, arrowTipY);
        ctx.lineTo(arrowLeft.x, arrowLeft.y);
        ctx.moveTo(arrowTipX, arrowTipY);
        ctx.lineTo(arrowRight.x, arrowRight.y);
        ctx.stroke();

        // Draw delete button (X) above the name
        const xButtonX = centerX;
        const xButtonY = centerY - 20; // Moved up
        ctx.fillStyle = '#FF0000';
        ctx.textAlign = 'center';
        ctx.fillText('×', xButtonX, xButtonY);
        
        // Store delete button hitbox
        line.xButton = {
            x: xButtonX - 8,
            y: xButtonY - 12,
            width: 16,
            height: 16
        };

        // Draw the name (if not currently being edited)
        if (lineCrossingState.editingName !== line.id) {
            // Create clickable area for name
            const nameX = centerX;
            const nameY = centerY - 8;
            
            // Draw name with shadow for better visibility
            ctx.fillStyle = '#00FFFF';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;
            
            const displayName = line.name || 'Line_Name'; 
            ctx.fillText(displayName, nameX, nameY);
            
            // Reset shadow
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Store clickable area for name editing
            line.nameArea = {
                x: nameX - 40,
                y: nameY - 15,
                width: 80,
                height: 20
            };
        }

        // Draw highlight if line is being hovered or dragged
        if (lineCrossingState.draggingLine === line || 
            (line.nameArea && isMouseOverArea(ctx.canvas.mouseX, ctx.canvas.mouseY, line.nameArea))) {
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            
            // Reset style
            ctx.strokeStyle = '#00FF00';
            ctx.lineWidth = 2;
        }
    });
}




// Update the canvas click handler
document.getElementById('virtualLoopCanvas').addEventListener('click', (event) => {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Check virtual loop delete buttons
    virtualLoopState.loops.forEach((loop, index) => {
        const button = loop.deleteButton;
        if (mouseX >= button.x && mouseX <= button.x + button.width &&
            mouseY >= button.y && mouseY <= button.y + button.height) {
            deleteVirtualLoop(index);
        }
    });

    // Check line crossing delete buttons
    lineCrossingState.lines.forEach((line, index) => {
        const { x, y, width, height } = line.xButton;
        if (mouseX >= x && mouseX <= x + width && mouseY >= y && mouseY <= y + height) {
            deleteLineCrossing(index);
        }
    });
});





// Modify the mousedown event listener for line crossings
document.getElementById('virtualLoopCanvas').addEventListener('mousedown', (event) => {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / canvas.width;
    const y = (event.clientY - rect.top) / canvas.height;
    const threshold = 0.02;
    
    let lineFound = false;

    // First check line crossings
    lineCrossingState.lines.forEach(line => {
        // Calculate arrow tip position
        const centerX = (line.start.x + line.end.x) / 2;
        const centerY = (line.start.y + line.end.y) / 2;
        const angle = line.angle || Math.PI/2;
        
        const arrowLength = 40 / canvas.width;
        const arrowTipX = centerX + Math.cos(angle) * arrowLength;
        const arrowTipY = centerY + Math.sin(angle) * arrowLength;

        // Check if clicking near line points
        if (Math.hypot(line.start.x - x, line.start.y - y) < threshold) {
            lineCrossingState.draggingLine = line;
            lineCrossingState.draggingPoint = 'start';
            lineFound = true;
        } else if (Math.hypot(line.end.x - x, line.end.y - y) < threshold) {
            lineCrossingState.draggingLine = line;
            lineCrossingState.draggingPoint = 'end';
            lineFound = true;
        } else if (Math.hypot(arrowTipX - x, arrowTipY - y) < threshold) {
            lineCrossingState.draggingLine = line;
            lineCrossingState.draggingPoint = 'rotate';
            lineFound = true;
        } else {
            const distanceToLine = pointToLineDistance(x, y, line.start, line.end);
            if (distanceToLine < threshold) {
                lineCrossingState.draggingLine = line;
                lineCrossingState.draggingPoint = 'line';
                lineFound = true;
            }
        }
    });

        // If we found a line to drag, stop here and prevent virtual loop handling
        if (lineFound) {
            event.stopPropagation();
            return;
        }
    
        // Only check virtual loops if we haven't found a line to drag
        virtualLoopState.loops.forEach(loop => {
            // Check if clicked inside the loop
            if (isInsideVirtualLoop(x, y, loop)) {
                virtualLoopState.isDragging = true;
                virtualLoopState.selectedLoop = loop;
                virtualLoopState.dragStartPos = { x, y };
                canvas.style.cursor = 'move';
                return;
            }
            
            // Check if clicked near any corner
            for (const corner in loop.corners) {
                const point = loop.corners[corner];
                const distance = Math.sqrt(
                    Math.pow((mouseX * canvas.width) - (point.x * canvas.width), 2) +
                    Math.pow((mouseY * canvas.height) - (point.y * canvas.height), 2)
                );
    
                if (distance < 10) {
                    virtualLoopState.isDragging = true;
                    virtualLoopState.selectedLoop = loop;
                    virtualLoopState.selectedCorner = corner;
                    virtualLoopState.dragStartPos = { x, y };
                    canvas.style.cursor = 'grabbing';
                    return;
                }
            }
        });
    });


// Update mousemove event listener
document.getElementById('virtualLoopCanvas').addEventListener('mousemove', (event) => {
    if (!lineCrossingState.draggingLine) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / canvas.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / canvas.height));

    const line = lineCrossingState.draggingLine;

    if (lineCrossingState.draggingPoint === 'rotate') {
        // Calculate center of the line
        const centerX = (line.start.x + line.end.x) / 2;
        const centerY = (line.start.y + line.end.y) / 2;
        
        // Calculate angle to mouse position
        const dx = x - centerX;
        const dy = y - centerY;
        line.angle = Math.atan2(dy, dx);
        
    } else if (lineCrossingState.draggingPoint === 'line') {
        const dx = x - (line.start.x + line.end.x) / 2;
        const dy = y - (line.start.y + line.end.y) / 2;
        line.start.x += dx;
        line.start.y += dy;
        line.end.x += dx;
        line.end.y += dy;
    } else {
        line[lineCrossingState.draggingPoint] = { x, y };
    }

    const ctx = canvas.getContext('2d');
    drawLineCrossings(ctx);
});






document.getElementById('virtualLoopCanvas').addEventListener('mouseup', () => {
    lineCrossingState.draggingLine = null;
    lineCrossingState.draggingPoint = null;
});





function pointToLineDistance(px, py, start, end) {
    const A = px - start.x;
    const B = py - start.y;
    const C = end.x - start.x;
    const D = end.y - start.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    const param = lenSq !== 0 ? dot / lenSq : -1;

    let nearestX, nearestY;
    if (param < 0) {
        nearestX = start.x;
        nearestY = start.y;
    } else if (param > 1) {
        nearestX = end.x;
        nearestY = end.y;
    } else {
        nearestX = start.x + param * C;
        nearestY = start.y + param * D;
    }

    return Math.hypot(px - nearestX, py - nearestY);
}




// Function to load configurations from the database
async function loadConfigurations() {
    const streamId = document.getElementById('streamIdDisplay').textContent;
    
    try {
        const response = await fetch(`/get_configurations/${streamId}`);
        const data = await response.json();
        
        if (data.success) {
            // Load virtual loops
            virtualLoopState.loops = data.virtualLoops.map(loop => ({
                id: loop.rfNumber,
                corners: loop.coordinates,
                roiNumber: loop.rfNumber,
                selectedCorner: null,
                dragging: false,
                dragStart: null
            }));

            // Load line crossings
            lineCrossingState.lines = data.lineCrossings.map(line => ({
                id: line.number,
                name: line.name,
                start: line.start,
                end: line.end
            }));

            // Redraw the canvas
            const canvas = document.getElementById('virtualLoopCanvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                drawVirtualLoop(ctx);
                drawLineCrossings(ctx);
            }
        }
    } catch (error) {
        console.error('Error loading configurations:', error);
    }
}




function updateMainTab() {
    const mainTab = document.getElementById('mainTab');
    const currentImage = document.getElementById('streamImage');
    const streamUrl = currentImage ? currentImage.src : '';
    
    if (mainTab) {
        // Keep the existing file input if it exists
        const existingFileInput = mainTab.querySelector('#engineFileInput');
        
        mainTab.innerHTML = `
            <div class="video-container">
                <div class="loading-spinner-container">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">Loading stream...</div>
                </div>
                <img src="${streamUrl}" id="streamImage" alt="Stream" style="display: none;">
            </div>
            <div class="controls-container">
                <button id="virtualLoopBtn" onclick="toggleVirtualLoop()" class="control-btn">
                    <i class="fa-solid fa-gear"></i>
                    Settings
                </button>
                <button id="enableNvdsAnalyticBtn" onclick="enableNvdsAnalytic()" class="control-btn">
                    <i class="fa-solid fa-play"></i>
                    Nvds-Analytic
                </button>
                <button id="ChangeModelBtn" onclick="ChangeModel()" class="control-btn">
                    <i class="fa-solid fa-plus"></i>
                    Change-Model
                </button>
            </div>
        `;

        // Always create a new file input
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'engineFileInput';
        fileInput.accept = '.engine';
        fileInput.style.display = 'none';
        mainTab.appendChild(fileInput);
        
        // Always attach the event listener
        fileInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (!file) return;
            
            if (!file.name.toLowerCase().endsWith('.engine')) {
                alert('Please select a valid .engine file');
                return;
            }

            try {
                const formData = new FormData();
                formData.append('engine_file', file);

                const mainTab = document.getElementById('mainTab');
                mainTab.innerHTML = `
                    <div class="video-container">
                        <div class="loading-spinner-container">
                            <div class="loading-spinner"></div>
                            <div class="loading-text">Uploading and configuring model...</div>
                        </div>
                    </div>
                `;

                const response = await fetch('/upload_engine', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                
                if (result.success) {
                    alert('Model updated successfully. System will restart to apply changes.');
                    
                    try {
                        // Restart streams
                        const restartResponse = await fetch('/restart_streams', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        });

                        if (restartResponse.ok) {
                            console.log('Streams restarted successfully, reloading page in 2 seconds...');
                            // Force reload page after delay
                            setTimeout(() => {
                                window.location.href = window.location.href;
                            }, 1000);
                        }
                    } catch (restartError) {
                        console.error('Error restarting streams:', restartError);
                        alert('Error restarting streams. Please refresh the page manually.');
                    }
                } else {
                    alert('Error: ' + result.message);
                    updateMainTab();
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Error uploading file. Please try again.');
                updateMainTab();
            }
        });

        setTimeout(() => {
            const loadingSpinner = document.querySelector('.loading-spinner-container');
            const streamImage = document.getElementById('streamImage');
            
            if (loadingSpinner) {
                loadingSpinner.classList.add('fade-out');
                setTimeout(() => {
                    loadingSpinner.remove();
                    if (streamImage) {
                        streamImage.style.display = 'block';
                    }
                }, 300);
            }
        }, 3000);
    }
}



// Add zoom state
const zoomState = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    lastOffsetX: 0,
    lastOffsetY: 0
};

// Initialize zoom container
function initZoomContainer() {
    const videoContainer = document.querySelector('.virtual-loop-container .video-container');
    const existingContainer = videoContainer.querySelector('.zoom-container');
    
    if (!existingContainer) {
        const zoomContainer = document.createElement('div');
        zoomContainer.className = 'zoom-container';
        
        // Move the image and canvas into the zoom container
        const img = videoContainer.querySelector('img');
        const canvas = videoContainer.querySelector('canvas');
        videoContainer.appendChild(zoomContainer);
        zoomContainer.appendChild(img);
        zoomContainer.appendChild(canvas);
        
        // Add event listeners for zoom and pan
        videoContainer.addEventListener('wheel', handleZoom);
        videoContainer.addEventListener('mousedown', startPan);
        videoContainer.addEventListener('mousemove', doPan);
        videoContainer.addEventListener('mouseup', endPan);
        videoContainer.addEventListener('mouseleave', endPan);
    }
}


// Separate zoom handling from dragging
function handleZoom(event) {
    event.preventDefault();
    
    // Only handle zoom if not dragging elements
    if (interactionState.activeElement) return;
    
    const container = event.currentTarget;
    const rect = container.getBoundingClientRect();
    
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    const delta = -Math.sign(event.deltaY) * 0.1;
    const newScale = Math.max(1, Math.min(5, zoomState.scale + delta));
    
    if (newScale !== zoomState.scale) {
        const scaleChange = newScale - zoomState.scale;
        zoomState.offsetX -= (mouseX - zoomState.offsetX) * (scaleChange / zoomState.scale);
        zoomState.offsetY -= (mouseY - zoomState.offsetY) * (scaleChange / zoomState.scale);
        zoomState.scale = newScale;
        
        updateZoomTransform();
    }
}


// Update pan handling to not interfere with element dragging
function startPan(event) {
    // Only handle right mouse button for panning
    if (event.button === 2 && !interactionState.activeElement) {
        event.preventDefault();
        const container = event.currentTarget;
        zoomState.isDragging = true;
        zoomState.startX = event.clientX - zoomState.offsetX;
        zoomState.startY = event.clientY - zoomState.offsetY;
        container.classList.add('grabbing');
    }
}


// Perform panning
function doPan(event) {
    if (zoomState.isDragging) {
        zoomState.offsetX = event.clientX - zoomState.startX;
        zoomState.offsetY = event.clientY - zoomState.startY;
        updateZoomTransform();
    }
}

// End panning
function endPan(event) {
    const container = event.currentTarget;
    zoomState.isDragging = false;
    container.classList.remove('grabbing');
}

// Update zoom transform
function updateZoomTransform() {
    const zoomContainer = document.querySelector('.zoom-container');
    if (zoomContainer) {
        zoomContainer.style.transform = `translate(${zoomState.offsetX}px, ${zoomState.offsetY}px) scale(${zoomState.scale})`;
    }
}


// Updated screenToCanvasCoordinates function for better accuracy
function screenToCanvasCoordinates(clientX, clientY) {
    const canvas = document.getElementById('virtualLoopCanvas');
    const rect = canvas.getBoundingClientRect();
    const zoomContainer = document.querySelector('.zoom-container');
    
    if (!zoomContainer) {
        const x = (clientX - rect.left) / canvas.width;
        const y = (clientY - rect.top) / canvas.height;
        return { x, y };
    }

    // Get the current transform matrix
    const transform = window.getComputedStyle(zoomContainer).transform;
    const matrix = new DOMMatrix(transform);
    
    // Get the zoom container's bounding rect for offset calculation
    const containerRect = zoomContainer.getBoundingClientRect();
    
    // Calculate the actual position relative to the canvas
    const zoomedX = (clientX - containerRect.left) / matrix.a;
    const zoomedY = (clientY - containerRect.top) / matrix.a;
    
    // Convert to normalized coordinates (0-1 range)
    return {
        x: zoomedX / canvas.width,
        y: zoomedY / canvas.height
    };
}


function initializeVirtualLoopTab() {
    // Reset zoom state
    zoomState.scale = 1;
    zoomState.offsetX = 0;
    zoomState.offsetY = 0;
    
    const videoContainer = document.querySelector('.virtual-loop-container .video-container');
    const existingContainer = videoContainer.querySelector('.zoom-container');
    
    if (!existingContainer) {
        const zoomContainer = document.createElement('div');
        zoomContainer.className = 'zoom-container';
        
        const img = videoContainer.querySelector('img');
        const canvas = videoContainer.querySelector('canvas');
        
        if (img && canvas) {
            // Remove existing event listeners first
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('click', handleCanvasClick);
            
            videoContainer.innerHTML = '';
            videoContainer.appendChild(zoomContainer);
            zoomContainer.appendChild(img);
            zoomContainer.appendChild(canvas);
            
            canvas.width = videoContainer.offsetWidth;
            canvas.height = videoContainer.offsetHeight;
            
            // Add zoom and pan events to container
            videoContainer.addEventListener('wheel', handleZoom);
            videoContainer.addEventListener('contextmenu', (e) => e.preventDefault());
            
            // Add interaction events to canvas
            canvas.addEventListener('mousedown', handleMouseDown);
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseup', handleMouseUp);
            canvas.addEventListener('click', handleCanvasClick);
            canvas.addEventListener('mousemove', updateHoverState);
            
            // Add pan events to container
            videoContainer.addEventListener('mousedown', (e) => {
                if (e.button === 2) startPan(e);
            });
            videoContainer.addEventListener('mousemove', doPan);
            videoContainer.addEventListener('mouseup', endPan);
            videoContainer.addEventListener('mouseleave', endPan);
        }
    }
    
    loadConfigurations();
    const canvas = document.getElementById('virtualLoopCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        drawVirtualLoop(ctx);
        drawLineCrossings(ctx);
    }
}


// Update how we handle virtual loop dragging
function handleVirtualLoopMouseMove(coords) {
    if (!virtualLoopState.isDragging || !virtualLoopState.selectedLoop) return;

    if (virtualLoopState.selectedCorner) {
        // Moving a corner
        virtualLoopState.selectedLoop.corners[virtualLoopState.selectedCorner] = {
            x: Math.max(0, Math.min(1, coords.x)),
            y: Math.max(0, Math.min(1, coords.y))
        };
    } else {
        // Moving the entire loop
        const dx = coords.x - virtualLoopState.dragStartPos.x;
        const dy = coords.y - virtualLoopState.dragStartPos.y;

        for (const corner in virtualLoopState.selectedLoop.corners) {
            const point = virtualLoopState.selectedLoop.corners[corner];
            point.x = Math.max(0, Math.min(1, point.x + dx));
            point.y = Math.max(0, Math.min(1, point.y + dy));
        }
        virtualLoopState.dragStartPos = coords;
    }

    // Redraw
    const canvas = document.getElementById('virtualLoopCanvas');
    const ctx = canvas.getContext('2d');
    drawVirtualLoop(ctx);
    drawLineCrossings(ctx);
}


// Add to your initializeVirtualLoopTab function
const videoContainer = document.querySelector('.virtual-loop-container .video-container');
videoContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
});


const style = document.createElement('style');
style.textContent = `
.line-name-input {
    position: absolute;
    background: rgba(0, 0, 0, 0.7);
    color: #00FFFF;
    border: 1px solid #00FFFF;
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 12px;
    text-align: center;
}

.line-name-input:focus {
    outline: none;
    border-color: #00FF00;
}
`;
document.head.appendChild(style);

function ChangeModel() {
    const fileInput = document.getElementById('engineFileInput');
    if (fileInput) {
        fileInput.click();
    } else {
        console.error('File input element not found');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    updateMainTab();
});


document.getElementById('engineFileInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    // Check if it's an .engine file
    if (!file.name.toLowerCase().endsWith('.engine')) {
        alert('Please select a valid .engine file');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('engine_file', file);

        // Show loading state
        const mainTab = document.getElementById('mainTab');
        mainTab.innerHTML = `
            <div class="video-container">
                <div class="loading-spinner-container">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">Uploading and configuring model...</div>
                </div>
            </div>
        `;

        // Upload the file
        const response = await fetch('/upload_engine', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        
        if (result.success) {
            alert('Model updated successfully. System will restart to apply changes.');
            // Restart streams after successful update
            await fetch('/restart_streams', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            // Update the main tab with loading state
            updateMainTab();
        } else {
            alert('Error: ' + result.message);
            updateMainTab();
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error uploading file. Please try again.');
        updateMainTab();
    }
});




// Call when the page loads
document.addEventListener('DOMContentLoaded', updateMainTab);





