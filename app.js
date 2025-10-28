// --- JAVASCRIPT LOGIC ---

// Root Options
const ROOTS = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"];

// DOM Elements
const currentRootEl = document.getElementById('current-root');
const upcomingRootEl = document.getElementById('upcoming-root');
const tempoSlider = document.getElementById('tempo-slider');
const bpmDisplay = document.getElementById('bpm-display');
const startStopBtn = document.getElementById('start-stop-btn');
const beatIndicator = document.getElementById('beat-indicator');
const beatOptions = document.querySelectorAll('input[name="beats-per-root"]');

// --- Metronome State and Constants ---
let audioContext = null;
let isRunning = false;
let tempo = 120; // BPM
let beatsPerRoot = 2;
let nextNoteTime = 0.0; 
let currentBeat = 0;    
let timerWorker = null; 
let wakeLock = null; 

const LOOK_AHEAD_TIME = 0.1; 
const SCHEDULE_INTERVAL = 25; 

// --- Root State ---
let currentRoot = 'C';
let upcomingRoot = 'G';

// --- Web Worker Code Embedded ---
const workerCode = `
    let timerID = null;
    let interval = 25; 

    self.onmessage = function(e) {
        if (e.data.interval) {
            interval = e.data.interval;
        } 
        if (e.data === 'start') {
            if (timerID) {
                clearInterval(timerID);
            }
            timerID = setInterval(tick, interval);
        }
    };

    function tick() {
        self.postMessage('tick');
    }
`;
const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
const workerURL = URL.createObjectURL(workerBlob);


// --- Wake Lock Functions (IMPROVED RELIABILITY) ---

/** Requests a screen wake lock if the API is available. */
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        // Only request if a lock isn't currently held
        if (!wakeLock) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => {
                    console.log('Wake Lock was released by the system.');
                    wakeLock = null;
                });
                console.log('Wake Lock is active.');
            } catch (err) {
                // This usually happens if the user hasn't interacted enough or permissions are denied.
                console.error(`Wake Lock failed: ${err.message}`);
                wakeLock = null;
            }
        }
    } else {
        console.warn('Wake Lock API not supported. Screen may dim.');
    }
}

/** Releases the screen wake lock. */
function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release()
            .then(() => {
                wakeLock = null;
                console.log('Wake Lock released successfully.');
            });
    }
}

// --- Core Functions (mostly unchanged) ---

function generateNewRoot(excludeRoot) {
    let newRoot;
    do {
        const randomIndex = Math.floor(Math.random() * ROOTS.length);
        newRoot = ROOTS[randomIndex];
    } while (newRoot === excludeRoot);
    return newRoot;
}

function updateRoots() {
    currentRoot = upcomingRoot;
    upcomingRoot = generateNewRoot(currentRoot);

    currentRootEl.textContent = currentRoot;
    upcomingRootEl.textContent = upcomingRoot;
}

function scheduleClick(time, beatNumber) {
    const isDownbeat = (beatNumber === 1);
    
    // Ensure the AudioContext is running before trying to schedule sound
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    const frequency = isDownbeat ? 880 : 440;
    const volume = isDownbeat ? 0.6 : 0.4;
    const duration = 0.05; 

    oscillator.type = 'sine'; 
    oscillator.frequency.setValueAtTime(frequency, 0);
    gainNode.gain.setValueAtTime(volume, time);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(time);
    oscillator.stop(time + duration);

    // --- Visual Update Scheduling ---
    const delayMilliseconds = (time - audioContext.currentTime) * 1000;

    setTimeout(() => {
        beatIndicator.textContent = `Beat ${beatNumber} of ${beatsPerRoot}`;
        
        if (isDownbeat) {
            currentRootEl.style.color = '#1abc9c'; 
            setTimeout(() => {
                currentRootEl.style.color = '#e74c3c'; 
            }, 50);
            updateRoots();
        }
    }, delayMilliseconds);
}

function scheduler() {
    const secondsPerBeat = 60.0 / tempo;

    while (nextNoteTime < audioContext.currentTime + LOOK_AHEAD_TIME) {
        
        currentBeat++;

        if (currentBeat > beatsPerRoot) {
            currentBeat = 1; 
        }

        scheduleClick(nextNoteTime, currentBeat);

        nextNoteTime += secondsPerBeat;
    }
}

// --- Control Functions ---

function startMetronome() {
    if (isRunning) return;
    
    // 1. **CRITICAL:** Request Wake Lock immediately
    requestWakeLock(); 

    // Initialize AudioContext
    if (audioContext === null) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    isRunning = true;
    startStopBtn.textContent = 'Stop Metronome';
    startStopBtn.classList.add('running');
    
    nextNoteTime = audioContext.currentTime + 0.1; 
    currentBeat = beatsPerRoot; 

    // 2. Start the Timer Worker
    timerWorker = new Worker(workerURL);
    
    timerWorker.onmessage = function(e) {
        if (e.data === 'tick') {
            scheduler();
        }
    };
    
    timerWorker.postMessage({
        'interval': SCHEDULE_INTERVAL,
        'lookAhead': LOOK_AHEAD_TIME
    });
    timerWorker.postMessage('start');
}

function stopMetronome() {
    // 1. Release Wake Lock
    releaseWakeLock();

    if (timerWorker) {
        timerWorker.terminate(); 
        timerWorker = null;
    }
    isRunning = false;
    startStopBtn.textContent = 'Start Metronome';
    startStopBtn.classList.remove('running');
    beatIndicator.textContent = '';
    currentBeat = 0;
    
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.suspend();
    }
}

/** Handles UI event listeners and Wake Lock re-acquisition. */
function setupListeners() {
    tempoSlider.addEventListener('input', (e) => {
        tempo = parseInt(e.target.value);
        bpmDisplay.textContent = `${tempo} BPM`;
    });

    startStopBtn.addEventListener('click', () => {
        if (isRunning) {
            stopMetronome();
        } else {
            startMetronome();
        }
    });

    beatOptions.forEach(radio => {
        radio.addEventListener('change', (e) => {
            beatsPerRoot = parseInt(e.target.value);
            if (isRunning) {
                 currentBeat = beatsPerRoot;
            }
        });
    });
    
    // 2. **CRITICAL
