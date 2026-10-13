
import './style.css';

// ==========================================
// MONITOR CARDÍACO
// Arduino UNO + MAX30105/MAX30102
// Conexión USB mediante Web Serial
// ==========================================

let port = null;
let reader = null;
let bpmData = [];
let maxBpm = 0;
let totalBpm = 0;
let samples = 0;
let threshold = 160;
let connected = false;
let reading = false;

const PULSO_MIN = 50;

const connectButton = document.getElementById('connectButton');
const bpmValue = document.getElementById('bpmValue');
const spo2Value = document.getElementById('spo2Value');
const currentBpm = document.getElementById('currentBpm');
const maxBpmElement = document.getElementById('maxBpm');
const averageBpm = document.getElementById('averageBpm');
const status = document.getElementById('status');
const alertBox = document.getElementById('alertBox');
const thresholdInput = document.getElementById('threshold');
const connectionText = document.getElementById('connectionText');
const connectionIndicator = document.getElementById('connectionIndicator');
const canvas = document.getElementById('heartChart');
const ctx = canvas.getContext('2d');

thresholdInput.addEventListener('change', () => {
    const value = Number(thresholdInput.value);

    if (Number.isFinite(value) && value >= PULSO_MIN && value <= 220) {
        threshold = value;
        drawChart();

        if (samples > 0) {
            updateStatus(Number(bpmValue.textContent));
        }
    } else {
        thresholdInput.value = threshold;
        alert('Introduce un límite entre 50 y 220 BPM.');
    }
});

connectButton.addEventListener('click', connectArduino);

// ==========================================
// CONECTAR ARDUINO POR USB
// ==========================================

async function connectArduino() {
    if (!('serial' in navigator)) {
        alert(
            'Tu navegador no soporta Web Serial. ' +
            'Abre la aplicación en una versión compatible de Chrome o Edge.'
        );
        return;
    }

    if (connected) {
        alert('Arduino ya está conectado.');
        return;
    }

    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });

        connected = true;

        connectionText.textContent = 'Arduino conectado por USB';
        connectionIndicator.classList.remove('offline');
        connectionIndicator.classList.add('online');

        connectButton.textContent = '✅ Arduino conectado';
        connectButton.disabled = true;

        readSerialData();
    } catch (error) {
        console.error('Error de conexión:', error);

        connectionText.textContent = 'Arduino desconectado';
        connectionIndicator.classList.remove('online');
        connectionIndicator.classList.add('offline');

        if (error.name !== 'NotFoundError') {
            alert('No fue posible conectar con Arduino. Comprueba el cable USB y vuelve a intentarlo.');
        }
    }
}

// ==========================================
// LEER LOS DATOS ENVIADOS POR ARDUINO
// ==========================================

async function readSerialData() {
    if (!port || !port.readable || reading) return;

    reading = true;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        reader = port.readable.getReader();

        while (true) {
            const { value, done } = await reader.read();

            if (done) break;

            if (value) {
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    processSerialData(line.trim());
                }
            }
        }
    } catch (error) {
        console.error('Error al recibir datos:', error);
    } finally {
        if (reader) {
            try {
                reader.releaseLock();
            } catch (error) {
                console.warn('No se pudo liberar el lector:', error);
            }
        }

        reader = null;
        reading = false;
        connected = false;

        connectionText.textContent = 'Arduino desconectado';
        connectionIndicator.classList.remove('online');
        connectionIndicator.classList.add('offline');

        connectButton.disabled = false;
        connectButton.textContent = '🔌 Reconectar Arduino';

        if (port) {
            try {
                await port.close();
            } catch (error) {
                console.warn('No se pudo cerrar el puerto:', error);
            }
        }

        port = null;
    }
}

// ==========================================
// INTERPRETAR LOS DATOS DE ARDUINO
// Formato esperado:
// Ritmo Cardiaco: 78 BPM | Oxigeno: 98 %
// ==========================================

function processSerialData(data) {
    if (!data) return;

    console.log('Arduino:', data);

    // Ignorar mensajes de estado y líneas de depuración.
    if (
        data.includes('MAX30105 no encontrado') ||
        data.includes('Coloca el sensor') ||
        data.includes('ARDUINO_LISTO') ||
        data.includes('Esperando medicion valida') ||
        data.includes('PULSO DENTRO DEL RANGO') ||
        data.includes('ALERTA: PULSO FUERA DEL RANGO') ||
        data.startsWith('red=') ||
        data.startsWith('ERROR_SENSOR')
    ) {
        return;
    }

    const bpmMatch = data.match(
        /Ritmo Cardiaco:\s*(-?\d+)\s*BPM/i
    );

    const spo2Match = data.match(
        /Oxigeno:\s*(-?\d+)\s*%/i
    );

    if (bpmMatch) {
        const bpm = Number(bpmMatch[1]);

        if (Number.isFinite(bpm) && bpm >= 30 && bpm <= 220) {
            updateBpm(bpm);
        }
    }

    if (spo2Match) {
        const spo2 = Number(spo2Match[1]);

        if (Number.isFinite(spo2) && spo2 >= 0 && spo2 <= 100) {
            updateSpo2(spo2);
        }
    }
}

// ==========================================
// ACTUALIZAR FRECUENCIA CARDÍACA
// ==========================================

function updateBpm(bpm) {
    bpmValue.textContent = bpm;
    currentBpm.textContent = bpm;

    if (bpm > maxBpm) {
        maxBpm = bpm;
    }

    totalBpm += bpm;
    samples++;

    maxBpmElement.textContent = maxBpm;
    averageBpm.textContent = Math.round(totalBpm / samples);

    bpmData.push({
        time: new Date(),
        bpm
    });

    if (bpmData.length > 60) {
        bpmData.shift();
    }

    updateStatus(bpm);
    drawChart();
}

// ==========================================
// ACTUALIZAR SpO2
// ==========================================

function updateSpo2(spo2) {
    spo2Value.textContent = spo2;
}

// ==========================================
// ESTADO Y ALERTA
// La alerta depende del pulso, no del SpO2.
// ==========================================

function updateStatus(bpm) {
    const fueraDeRango = bpm < PULSO_MIN || bpm > threshold;

    if (fueraDeRango) {
        showAlert();
    } else {
        showNormal();
    }
}

function showNormal() {
    status.textContent = '🟢 PULSO DENTRO DEL RANGO';
    status.classList.remove('high');
    status.classList.add('normal');
    alertBox.classList.add('hidden');
}

function showAlert() {
    status.textContent = '🔴 PULSO FUERA DEL RANGO';
    status.classList.remove('normal');
    status.classList.add('high');
    alertBox.classList.remove('hidden');
}

// ==========================================
// GRÁFICA DE FRECUENCIA CARDÍACA
// ==========================================

function drawChart() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height) return;

    const ratio = window.devicePixelRatio || 1;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (bpmData.length === 0) return;

    const min = 40;
    const max = 180;

    // Líneas horizontales y etiquetas
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.font = '12px Arial';

    for (let bpm = min; bpm <= max; bpm += 20) {
        const y = height - ((bpm - min) / (max - min)) * height;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        ctx.fillStyle = '#9ca3af';
        ctx.fillText(String(bpm), 5, Math.max(12, y - 4));
    }

    // Línea del límite máximo configurado
    if (threshold >= min && threshold <= max) {
        const thresholdY =
            height - ((threshold - min) / (max - min)) * height;

        ctx.strokeStyle = '#ef4444';
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.moveTo(0, thresholdY);
        ctx.lineTo(width, thresholdY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Línea de BPM
    ctx.beginPath();

    bpmData.forEach((point, index) => {
        const x =
            (index / Math.max(bpmData.length - 1, 1)) * width;

        const y =
            height - ((point.bpm - min) / (max - min)) * height;

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Puntos de medición
    bpmData.forEach((point, index) => {
        const x =
            (index / Math.max(bpmData.length - 1, 1)) * width;

        const y =
            height - ((point.bpm - min) / (max - min)) * height;

        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    });
}

window.addEventListener('resize', drawChart);

