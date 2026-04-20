/**
 * Dollympo Wheel of Fortune Logic
 */

const pastelColors = [
    '#ffb3ba', // Pastel Red
    '#ffdfba', // Pastel Orange
    '#ffffba', // Pastel Yellow
    '#baffc9', // Pastel Green
    '#bae1ff', // Pastel Blue
    '#e8baff', // Pastel Purple
    '#fce4ec', // Soft Pink
    '#e0f7fa'  // Soft Cyan
];

// App State
let dolls = [];
let loadedImages = {}; // cache html Image objects for canvas rendering
let isSpinning = false;
let currentRotation = 0;
let spinVelocity = 0;
let animationFrameId = null;

// IndexedDB Setup
const DB_NAME = 'DollympoDB';
const DB_VERSION = 1;
const STORE_NAME = 'dolls';
let db;

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (e) => {
            console.error('IndexedDB error:', e);
            reject(e);
        };
        
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve();
        };
        
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

async function loadDollsFromDB() {
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => {
            dolls = request.result || [];
            // preload image objects
            let loadPromises = dolls.map(doll => preloadImage(doll));
            Promise.all(loadPromises).then(() => {
                renderRoster();
                drawWheel();
                updateSpinButtonState();
                resolve();
            });
        };
    });
}

async function saveDollToDB(doll) {
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(doll);
        transaction.oncomplete = () => resolve();
    });
}

async function deleteDollFromDB(id) {
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(id);
        transaction.oncomplete = () => resolve();
    });
}

function preloadImage(doll) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            loadedImages[doll.id] = img;
            resolve();
        };
        img.onerror = () => {
            console.error("Failed to load image for: ", doll.name);
            resolve(); // Resolve anyway so Promise.all completes
        };
        img.src = doll.image;
    });
}

// UI Elements
const uploadInput = document.getElementById('doll-upload');
const listContainer = document.getElementById('doll-list');
const canvas = document.getElementById('wheel');
const ctx = canvas.getContext('2d');
const spinBtn = document.getElementById('spin-btn');
const modal = document.getElementById('modal');

// Upload Handlers
uploadInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    for (const file of files) {
        // Compress/resize the image a bit dynamically using canvas
        const base64 = await readFileAsBase64(file);
        
        // Remove extension from name to look cleaner
        const cleanName = file.name.replace(/\.[^/.]+$/, "");
        
        const newDoll = {
            id: Date.now().toString() + Math.random().toString(16).slice(2),
            name: cleanName,
            image: base64,
            color: pastelColors[dolls.length % pastelColors.length]
        };
        
        await preloadImage(newDoll);
        dolls.push(newDoll);
        await saveDollToDB(newDoll);
    }
    
    // Update colors for sequence
    recolorDolls();
    
    renderRoster();
    drawWheel();
    updateSpinButtonState();
    
    // reset input
    uploadInput.value = '';
});

function readFileAsBase64(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            // Optional: You could draw to offscreen canvas to scale down if images are huge
            resolve(e.target.result);
        };
        reader.readAsDataURL(file);
    });
}

// Roster Rendering
function renderRoster() {
    listContainer.innerHTML = '';
    
    dolls.forEach(doll => {
        const div = document.createElement('div');
        div.className = 'doll-item';
        
        const img = document.createElement('img');
        img.src = doll.image;
        
        const span = document.createElement('span');
        span.textContent = doll.name;
        span.contentEditable = true;
        span.title = "点击此文字编辑名字"; // click to edit
        
        span.addEventListener('blur', async () => {
            const newName = span.textContent.trim();
            if (newName !== '' && newName !== doll.name) {
                doll.name = newName;
                await saveDollToDB(doll);
            } else {
                span.textContent = doll.name; // reverse if empty
            }
        });
        
        span.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                span.blur();
            }
        });
        
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.innerHTML = '✕';
        delBtn.onclick = async () => {
            await deleteDollFromDB(doll.id);
            dolls = dolls.filter(d => d.id !== doll.id);
            delete loadedImages[doll.id];
            recolorDolls();
            renderRoster();
            drawWheel();
            updateSpinButtonState();
        };
        
        div.appendChild(img);
        div.appendChild(span);
        div.appendChild(delBtn);
        listContainer.appendChild(div);
    });
}

function recolorDolls() {
    dolls.forEach((doll, index) => {
        doll.color = pastelColors[index % pastelColors.length];
        saveDollToDB(doll); // async but we can just fire and forget here
    });
}

function updateSpinButtonState() {
    spinBtn.disabled = dolls.length === 0 || isSpinning;
}

// Wheel Canvas Rendering
function drawWheel() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 10;
    
    if (dolls.length === 0) {
        // Draw empty state
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#f0f0f0';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ddd';
        ctx.stroke();
        
        ctx.fillStyle = '#bbb';
        ctx.font = '24px Quicksand';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('添加怪怪来转动吧！', centerX, centerY);
        return;
    }

    const sliceAngle = (Math.PI * 2) / dolls.length;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(currentRotation);

    dolls.forEach((doll, i) => {
        const startAngle = i * sliceAngle;
        const endAngle = startAngle + sliceAngle;

        // Draw Wedge Slice
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = doll.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Draw Image inside the slice
        const angleMid = startAngle + sliceAngle / 2;
        
        // Calculate the maximum possible size for the image circle
        // The width of the arc at distance `imgDist` is `2 * Math.sin(sliceAngle/2) * imgDist`
        const imgDist = radius * 0.65; 
        const maxImgRadius = Math.min(
            radius * 0.25, // not too close to edges
            (Math.sin(sliceAngle / 2) * imgDist) - 5 // fit within the wedge width
        );
        
        const imgRadius = dolls.length === 1 ? radius * 0.5 : maxImgRadius;

        ctx.save();
        ctx.rotate(angleMid);
        ctx.translate(imgDist, 0);
        
        // Rotate back 90 deg if we want the images pointing outwards, 
        // OR rotate -angleMid to keep them upright (if they were drawn without rotation).
        // For a wheel, pointing outwards is standard. We rotate an extra 90 deg so top of image is towards edge.
        ctx.rotate(Math.PI / 2);

        // Clip circle for image
        ctx.beginPath();
        ctx.arc(0, 0, imgRadius, 0, Math.PI * 2);
        ctx.closePath();
        
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.clip(); // clip to circle
        
        const img = loadedImages[doll.id];
        if (img) {
            // draw image scaled to fit the circle
            // To cover the circle crop, we simulate object-fit: cover
            const aspect = img.width / img.height;
            let drawW = imgRadius * 2;
            let drawH = imgRadius * 2;
            let drawX = -imgRadius;
            let drawY = -imgRadius;
            
            if (aspect > 1) { // wider
                drawW = (imgRadius * 2) * aspect;
                drawX = -drawW / 2;
            } else { // taller
                drawH = (imgRadius * 2) / aspect;
                drawY = -drawH / 2;
            }
            
            ctx.drawImage(img, drawX, drawY, drawW, drawH);
        } else {
            // fallback if no image loaded
            ctx.fillStyle = '#fff';
            ctx.fill();
        }

        ctx.restore();
    });

    ctx.restore();
    
    // Draw Center knob
    ctx.beginPath();
    ctx.arc(centerX, centerY, 25, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffb3ba';
    ctx.stroke();
}

// Spin Physics
spinBtn.addEventListener('click', () => {
    if (isSpinning || dolls.length === 0) return;
    
    isSpinning = true;
    updateSpinButtonState();
    
    // Initial velocity + some random extra to randomize the spin
    // velocity is in radians per frame
    spinVelocity = 0.5 + Math.random() * 0.3; 
    
    requestAnimationFrame(spinAnimation);
});

function spinAnimation() {
    currentRotation += spinVelocity;
    
    // Ease out friction
    if (spinVelocity > 0.05) {
        spinVelocity -= 0.002;
    } else if (spinVelocity > 0.005) {
        spinVelocity -= 0.0005;
    } else {
        spinVelocity -= 0.0001; // super slow near the end
    }
    
    if (spinVelocity <= 0) {
        spinVelocity = 0;
        isSpinning = false;
        
        // Normalize rotation to 0-2PI
        currentRotation = currentRotation % (Math.PI * 2);
        
        updateSpinButtonState();
        drawWheel();
        declareWinner();
        return;
    }
    
    drawWheel();
    animationFrameId = requestAnimationFrame(spinAnimation);
}

function declareWinner() {
    // The pointer is at the top. Top is -90 degrees, or 270 degrees (1.5 * PI).
    // The canvas coordinates are rotated by currentRotation.
    // The top of the wheel (relative to unrotated wheel) currently sitting at the top of the screen
    // is at angle: (Math.PI * 1.5 - currentRotation + Math.PI * 2) % (Math.PI * 2)
    
    const pointerAngle = Math.PI * 1.5;
    let normalizedRotation = currentRotation % (Math.PI * 2);
    if (normalizedRotation < 0) normalizedRotation += Math.PI * 2;
    
    let landingAngle = (pointerAngle - normalizedRotation + Math.PI * 2) % (Math.PI * 2);
    
    const sliceAngle = (Math.PI * 2) / dolls.length;
    let winnerIndex = Math.floor(landingAngle / sliceAngle);
    
    const winner = dolls[winnerIndex];
    
    // Show Modal
    document.getElementById('winner-img').src = winner.image;
    document.getElementById('winner-name').textContent = winner.name;
    modal.classList.remove('hidden');
    
    // Confetti
    fireConfetti();
}

function fireConfetti() {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10000 };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        
        // Only pastel colors for confetti
        const colors = ['#ffb3ba', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff'];

        confetti(Object.assign({}, defaults, { 
            particleCount, 
            colors: colors,
            origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } 
        }));
        confetti(Object.assign({}, defaults, { 
            particleCount, 
            colors: colors,
            origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } 
        }));
    }, 250);
}

document.getElementById('close-modal').addEventListener('click', () => {
    modal.classList.add('hidden');
});

// Init
window.addEventListener('load', async () => {
    drawWheel(); // draw empty state
    await initDB();
    await loadDollsFromDB();
});
