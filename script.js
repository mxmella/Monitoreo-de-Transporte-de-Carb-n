document.addEventListener('DOMContentLoaded', () => {
  // Declare global variables used in the script
  
  // Lógica de Pantalla de Carga
  const loader = document.getElementById('app-loader');
  if (loader) {
    // Mantenemos el loader visible por al menos 2.5 segundos para dar tiempo a la conexión
    setTimeout(() => {
      loader.classList.add('loader-hidden');
      // Remover del DOM después de la transición CSS
      setTimeout(() => {
        loader.style.display = 'none';
      }, 600);
    }, 2500);
  }

  // Variables para modo oscuro persistente
  const bodyEl = document.body;
  const darkToggle = document.getElementById('darkModeToggle');
  const savedTheme = localStorage.getItem('theme');
  if(savedTheme === 'dark') {
   bodyEl.classList.add('dark-mode');
    if(darkToggle) darkToggle.textContent = 'Modo claro';
  }

  if(darkToggle) {
    darkToggle.addEventListener('click', () => {
      bodyEl.classList.toggle('dark-mode');
      if(bodyEl.classList.contains('dark-mode')) {
        darkToggle.textContent = 'Modo claro';
        localStorage.setItem('theme', 'dark');
      } else {
        darkToggle.textContent = 'Modo oscuro';
        localStorage.setItem('theme', 'light');
      }
    });
  }

  // --- Toast Notification Function ---
  function showToast(message, type = 'info', duration = 3000) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    }, duration);
  }
  window.showToast = showToast; // Make it globally accessible if needed by inline handlers

  // Botón para generar informe (Imprimir / PDF)
  const reportBtn = document.getElementById('reportBtn');
  if(reportBtn) {
    reportBtn.addEventListener('click', () => {
      showToast("Generando informe para impresión...", "info");
      
      // Agregar fecha y hora al reporte
      const tsEl = document.getElementById('reportTimestamp');
      if(tsEl) tsEl.textContent = `Generado el: ${new Date().toLocaleString()}`;

      // Imprimir y luego restaurar
      setTimeout(() => {
        window.print();
      }, 500);
    });
  }

  // MQTT y Chart.js con Zoom plugin
  const MQTT_BROKER_URL = 'wss://mqtt-dashboard.com:8884/mqtt';
  const mqttOptions = {
    keepalive: 60,
    reconnectPeriod: 1000,
    clean: true
  };
  const client = mqtt.connect(MQTT_BROKER_URL, mqttOptions);
  const myChartCanvas = document.getElementById('myChart');
  const ctx = myChartCanvas ? myChartCanvas.getContext('2d') : null;

  if (!ctx) { console.error("Canvas for myChart not found!"); return; }
  
  // Variables para Watchdog (Monitor de flujo de datos)
  let lastDataTime = Date.now();
  const DATA_TIMEOUT = 15000; // 15 segundos sin datos = alerta

  // Variables de estado del sistema de transporte
  let lastFlowValue = 0;
  let isBeltRunning = null; // null: desconocido, true: operando, false: detenida
  const MAX_BELT_CAPACITY = 2000; // Capacidad máxima de diseño de la cinta
  let lastStopTime = null;
  let currentShiftTotal = 0;
  let currentWorkingHours = 0;
  let currentWorkingMinutes = 0;
  let performanceChart = null;

  // Optimización: Manejo de reconexión al volver a la pestaña
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastDataTime = Date.now(); // Resetear watchdog para evitar falsa alarma
      if (client && !client.connected && typeof client.reconnect === 'function') {
        console.log('Pestaña visible: Forzando reconexión...');
        client.reconnect();
      }
    }
  });

  // Verificar flujo de datos periódicamente
  setInterval(() => {
    if (document.hidden) return; // No verificar en segundo plano para evitar falsos positivos
    
    const statusEl = document.getElementById('connectionStatus');
    const textEl = document.getElementById('connText');
    
    // Solo si el cliente MQTT está conectado, verificamos si llegan datos
    if (client && client.connected) {
      if (Date.now() - lastDataTime > DATA_TIMEOUT) {
        if (statusEl) statusEl.className = 'status-warning';
        if (textEl) textEl.textContent = 'Sin flujo de datos';
      } else if (statusEl && textEl) {
        // Only change back to connected if it was previously a warning
        if (statusEl.classList.contains('status-warning')) {
          statusEl.className = 'status-connected';
          textEl.textContent = 'Conectado';
        }
      }
    }
  }, 2000);

  // Chart.js setup
  // Crear degradados para el gráfico principal
  const gradientCGE = ctx.createLinearGradient(0, 0, 0, 400);
  gradientCGE.addColorStop(0, 'rgba(71, 85, 105, 0.6)');
  gradientCGE.addColorStop(1, 'rgba(71, 85, 105, 0.05)');

  const gradientSecondary = ctx.createLinearGradient(0, 0, 0, 400);
  gradientSecondary.addColorStop(0, 'rgba(245, 158, 11, 0.6)');
  gradientSecondary.addColorStop(1, 'rgba(245, 158, 11, 0.05)');

  // Inicialización de datos vacíos para mostrar grilla al inicio
  const initLabels = [];
  const initData1 = [];
  const nowInit = new Date();
  for(let i=19; i>=0; i--) {
    initLabels.push(new Date(nowInit.getTime() - i*2000).toLocaleTimeString());
    initData1.push(null);
  }

  const data = {
    labels: initLabels, 
    datasets: [{
      label: 'Flujo Cinta 1 (Ton/h)', 
      data: initData1,
      borderColor: '#475569',
      backgroundColor: gradientCGE,
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 7,
      borderWidth: 3,
      hoverBorderWidth: 4
    }]
  };

  const config = {
    type: 'line',
    data,
    options: {
      maintainAspectRatio: false,
      animation: false,
      responsive: true,
      plugins: {
        legend: {
          labels: { color: getComputedStyle(document.body).getPropertyValue('--color-primary').trim() || '#0a3d66', font: { size: 16, weight: 'bold' } }
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x'
          },
          zoom: { 
            enabled: true, 
            mode: 'x' 
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: '#0a72c1',
          titleFont: { size: 16, weight: 'bold' },
          bodyFont: { size: 14 }
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Tiempo de Descarga', color: getComputedStyle(document.body).getPropertyValue('--color-primary').trim() || '#0a3d66', font: { size: 18, weight: 'bold' } },
          ticks: { color: getComputedStyle(document.body).getPropertyValue('--color-primary').trim() || '#0a3d66', maxRotation: 45, minRotation: 30 },
          grid: { color: 'rgba(10, 61, 102, 0.08)', borderDash: [5, 5] }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Tonelaje / Hora', color: getComputedStyle(document.body).getPropertyValue('--color-primary').trim() || '#0a3d66', font: { size: 18, weight: 'bold' } },
          ticks: { color: getComputedStyle(document.body).getPropertyValue('--color-primary').trim() || '#0a3d66' },
          grid: { color: 'rgba(10, 61, 102, 0.08)', borderDash: [5, 5] }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  };
  const myChart = new Chart(ctx, config);
  
  // Inicialización del Gráfico de Rendimiento (Total vs Horas)
  const perfCanvas = document.getElementById('performanceChart');
  if (perfCanvas) {
    performanceChart = new Chart(perfCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Estado del Turno'],
        datasets: [
          {
            label: 'Producción (Ton)',
            data: [0],
            backgroundColor: '#ea580c',
            yAxisID: 'yTon',
            borderRadius: 8
          },
          {
            label: 'Tiempo (Hrs)',
            data: [0],
            backgroundColor: '#334155',
            yAxisID: 'yHours',
            borderRadius: 8
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        scales: {
          yTon: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Toneladas', font: { weight: 'bold' } },
            beginAtZero: true
          },
          yHours: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Horas Decimales', font: { weight: 'bold' } },
            beginAtZero: true,
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  // Optimización: Throttle para actualizaciones del gráfico principal
  let myChartUpdatePending = false;
  const requestMyChartUpdate = () => {
    if (!myChartUpdatePending) {
      myChartUpdatePending = true;
      requestAnimationFrame(() => {
        myChart.update();
        myChartUpdatePending = false;
      });
    }
  };
  
  // Alertas
  const alertContainer = document.getElementById('alertContainer');
  let alertActive = false;

  function showVisualAlert(value) {
    if(alertContainer) {
      alertContainer.style.display = 'block';
      alertContainer.textContent = `⚠️ Alerta: Valor alto detectado! Valor actual: ${value.toFixed(2)}`;

      setTimeout(() => {
        if(alertActive) return;
        alertContainer.style.display = 'none';
      }, 5000);
    }
  }


  /**
   * Centraliza la actualización de la interfaz relacionada con el flujo de la cinta.
   * @param {number} value - Valor actual del flujo en Ton/h
   */
  function updateBeltUI(value) {
    // 1. Actualizar Valor Numérico Principal
    const topic1ValueEl = document.getElementById('topic1Value');
    if (topic1ValueEl) topic1ValueEl.textContent = Math.round(value);

    // 2. Actualizar Indicador de Tendencia
    const trendEl = document.getElementById('flowTrend');
    if (trendEl) {
      if (value > lastFlowValue + 5) {
        trendEl.innerHTML = '▲'; trendEl.className = 'trend-indicator trend-up';
      } else if (value < lastFlowValue - 5) {
        trendEl.innerHTML = '▼'; trendEl.className = 'trend-indicator trend-down';
      } else {
        trendEl.innerHTML = '●'; trendEl.className = 'trend-indicator trend-stable';
      }
    }
    lastFlowValue = value;

    // 3. Actualizar Barra de Capacidad
    const capBar = document.getElementById('capacityBar');
    if (capBar) {
      const percent = Math.min((value / MAX_BELT_CAPACITY) * 100, 100);
      capBar.style.width = `${percent}%`;
      capBar.style.background = percent > 90 ? '#ef4444' : 'var(--color-accent)';
      const capPercentEl = document.getElementById('capacityPercent');
      if(capPercentEl) capPercentEl.textContent = `(${Math.round(percent)}%)`;
    }

    // 4. Log de Eventos (Detección de estado)
    const currentlyRunning = value > 50;
    
    // Initial state check
    if (isBeltRunning === null) {
      isBeltRunning = currentlyRunning;
      if (!currentlyRunning) {
        lastStopTime = Date.now();
        addEventLog("Cinta inicialmente detenida. Iniciando registro de tiempo muerto.", false);
      } else {
        addEventLog("Cinta inicialmente operando.", true);
      }
      return; // Exit after initial state setup
    }

    if (isBeltRunning === null) {
      isBeltRunning = currentlyRunning;
      if (!currentlyRunning) lastStopTime = Date.now();
    } else if (currentlyRunning !== isBeltRunning) {
      const now = Date.now();
      if (currentlyRunning) {
        // Reanudación: Calcular cuánto duró la parada
        const stopDurationMs = now - lastStopTime;
        addEventLog(`Cinta reanudada. Parada duró: ${formatDuration(stopDurationMs)}`, true);
        lastStopTime = null;
      } else {
        // Detención: Iniciar cronómetro de parada
        lastStopTime = now;
        addEventLog("Cinta detenida. Iniciando registro de tiempo muerto.", false);
      }
      isBeltRunning = currentlyRunning;
    }
  }

  /**
   * Formatea milisegundos a HH:MM:SS
   */
  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Agrega una entrada al log de eventos industrial.
   */
  function addEventLog(message, isStart) {
    const logBody = document.getElementById('eventLogBody');
    if (!logBody) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    const statusClass = isStart ? 'log-start' : 'log-stop';
    const statusText = isStart ? '[ARRANQUE]' : '[PARADA]';

    entry.innerHTML = `
      <span class="log-time">${timeStr}</span>
      <span class="log-msg"><span class="${statusClass}">${statusText}</span> ${message}</span>
    `;

    logBody.prepend(entry);
    while (logBody.children.length > 30) logBody.lastElementChild.remove();
  }

  /**
   * Exporta el contenido del log de eventos a un archivo .txt.
   */
  window.exportEventLog = () => {
    const logBody = document.getElementById('eventLogBody');
    if(!logBody) return;
    const text = Array.from(logBody.children).map(el => el.innerText.replace(/\t/g, ' ')).join('\n');
    const blob = new Blob([`LOG DE EVENTOS - TRANSPORTE CARBÓN\nGenerado: ${new Date().toLocaleString()}\n\n${text}`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log_cinta_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Historial de eventos exportado", "success");
  };

   // Suscripción al topic
  client.on('connect', () => {
    console.log('Conectado al broker MQTT');
    showToast("Conectado al servidor de datos", "success");
    const textEl = document.getElementById('connText');
    const statusEl = document.getElementById('connectionStatus');
    if(textEl) textEl.textContent = 'Conectado';
    if(statusEl) statusEl.className = 'status-connected';

    lastDataTime = Date.now();
    client.subscribe('Flujo_CT_1');
    client.subscribe('TOTALIZADOR');
    client.subscribe('TOTALIZADOR_TURNO');
    client.subscribe('PERMISIVO_COLBUN_STATUS');
    client.subscribe('HORAS_TRABAJADAS');
    client.subscribe('MINUTOS_TRABAJADOS');
    client.subscribe('CINTA_0_STATUS');
    client.subscribe('CINTA_1_STATUS');
    client.subscribe('CINTA_2_STATUS');
    client.subscribe('CINTA_3_STATUS');
    client.subscribe('CINTA_4_STATUS');
    client.subscribe('AV_01_Run');
    client.subscribe('AV_02_Run');
    client.subscribe('AV_03_Run');
    client.subscribe('AV_04_Run');
  });
   
  client.on('reconnect', () => {
    const textEl = document.getElementById('connText');
    const statusEl = document.getElementById('connectionStatus');
    if(textEl) textEl.textContent = 'Reconectando...';
    if(statusEl) statusEl.className = 'status-reconnecting';
  });

  client.on('close', () => {
    const textEl = document.getElementById('connText');
    const statusEl = document.getElementById('connectionStatus');
    if(textEl) textEl.textContent = 'Desconectado';
    if(statusEl) statusEl.className = 'status-disconnected';
  });

  client.on('error', (err) => {
    console.error('Error MQTT:', err);
    showToast("Error de conexión MQTT", "error");
    const textEl = document.getElementById('connText');
    const statusEl = document.getElementById('connectionStatus');
    if(textEl) textEl.textContent = 'Error de conexión';
    if(statusEl) statusEl.className = 'status-disconnected';
  });

  client.on('message', (topic, message) => {
    lastDataTime = Date.now();

    // Manejo especial para topics de estado (true/false)
    const beltMatch = topic.match(/CINTA_(\d+)_STATUS/);
    const hopperMatch = topic.match(/AV_(\d+)_Run/);

    if (beltMatch) {
      const statusValue = message.toString().toLowerCase() === 'true';
      updateItemStatusIndicator('cinta', beltMatch[1], statusValue);
      return;
    } else if (hopperMatch) {
      const statusValue = message.toString().toLowerCase() === 'true';
      // Convertimos "01" a "1" para que coincida con el ID del HTML
      const id = parseInt(hopperMatch[1], 10).toString();
      updateItemStatusIndicator('tolva', id, statusValue);
      return;
    } else if (topic === 'PERMISIVO_COLBUN_STATUS') {
      const statusValue = message.toString().toLowerCase() === 'true';
      // Usamos 'permisivo' como tipo y 'colbun' como ID para la función genérica
      updateItemStatusIndicator('permisivo', 'colbun', statusValue);
      return;
    }

    const value = parseFloat(message.toString());
    if (isNaN(value)) { return; }

    switch (topic) {
      case 'Flujo_CT_1': {
        const topic1Loader = document.getElementById('topic1Loader');
        const topic1Content = document.getElementById('topic1Content');

        if(topic1Loader) topic1Loader.style.display = 'none';
        if(topic1Content) topic1Content.style.display = 'block';
        
        updateBeltUI(value); // This function handles its own UI updates

        // Alert logic
        const ALERT_THRESHOLD = 120; // Define as a constant
        if(value > ALERT_THRESHOLD) {
          if (!alertActive) { // Activate alert only if not already active
            alertActive = true; // Set flag to prevent repeated alerts
            showVisualAlert(value);
          }
        } else {
          alertActive = false; // Deactivate alert
          if(alertContainer) alertContainer.style.display = 'none'; // Hide alert message
        }

        const now = new Date();
        const timeLabel = now.toLocaleTimeString();

        // Actualizar datos del gráfico
        data.labels.push(timeLabel);
        data.datasets[0].data.push(value);

        const MAX_CHART_DATA_POINTS = 20; // Define as a constant
        while (data.labels.length > MAX_CHART_DATA_POINTS) {
          data.labels.shift();
          data.datasets[0].data.shift();
        }

        const chartLoader = document.getElementById('myChartLoader');
        if (chartLoader) chartLoader.style.display = 'none';
        requestMyChartUpdate();
        break;
      }

      case 'TOTALIZADOR': {
        const topic3El = document.getElementById('topic3');
        const loader3 = document.getElementById('topic3Loader');
        const content3 = document.getElementById('topic3Content');

        if (topic3El) topic3El.innerHTML = `${Math.round(value)} <span class="metric-unit">Ton</span>`;
        if (loader3) loader3.style.display = 'none';
        if (content3) content3.style.display = 'block';
        break;
      }

      case 'TOTALIZADOR_TURNO': {
        const lastPeakValueEl = document.getElementById('lastPeakValue');
        const lastPeakDateEl = document.getElementById('lastPeakDate');
        const loader = document.getElementById('lastPeakLoader');
        const content = document.getElementById('lastPeakContent');

        if (lastPeakValueEl) lastPeakValueEl.innerHTML = `${Math.round(value)} <span class="metric-unit">Ton</span>`;
        if (lastPeakDateEl) lastPeakDateEl.textContent = `Actualizado: ${new Date().toLocaleTimeString()}`;
        currentShiftTotal = value;
        if (loader) loader.style.display = 'none';
        if (content) content.style.display = 'block';
        updatePerformanceChart();
        break;
      }

      case 'HORAS_TRABAJADAS': {
        currentWorkingHours = Math.round(value);
        updateWorkingHoursUI();
        break;
      }
      case 'MINUTOS_TRABAJADOS': {
        currentWorkingMinutes = Math.round(value);
        updateWorkingHoursUI();
        break;
      }
    } // End of switch
  });

  /**
   * Actualiza el indicador de estado de una cinta o tolva.
   * @param {string} type - El tipo de elemento ('cinta' o 'tolva').
   * @param {string} id - El número identificador.
   * @param {boolean} isRunning - True si está operando, false si está detenida.
   */
  function updateItemStatusIndicator(type, id, isRunning) {
    const indicatorEl = document.getElementById(`${type}-status-${id}`);
    const textEl = indicatorEl ? indicatorEl.querySelector('.status-text') : null;

    if (indicatorEl && textEl) {
      if (isRunning) {
        indicatorEl.className = 'status-indicator status-running';
        textEl.textContent = 'Operando';
      } else {
        indicatorEl.className = 'status-indicator status-stopped';
        textEl.textContent = 'Detenida';
      }
    }
  }

  /**
   * Actualiza la interfaz de Horas Trabajadas combinando horas y minutos.
   */
  function updateWorkingHoursUI() {
    const loader = document.getElementById('workingHoursLoader');
    const content = document.getElementById('workingHoursContent');
    const valueEl = document.getElementById('workingHoursValue');

    if(loader) loader.style.display = 'none';
    if(content) content.style.display = 'block';

    if(valueEl) {
      const h = currentWorkingHours.toString().padStart(2, '0');
      const m = currentWorkingMinutes.toString().padStart(2, '0');
      valueEl.textContent = `${h}:${m}`;
      updatePerformanceChart();
    }
  }

  /**
   * Actualiza el gráfico de barras comparativo y la tarjeta de eficiencia.
   */
  function updatePerformanceChart() {
    if (!performanceChart) return;
    
    const decimalHours = currentWorkingHours + (currentWorkingMinutes / 60);
    
    // Actualizar Gráfico
    performanceChart.data.datasets[0].data[0] = Math.round(currentShiftTotal);
    performanceChart.data.datasets[1].data[0] = parseFloat(decimalHours.toFixed(2));
    performanceChart.update();

    // Actualizar Tarjeta de Eficiencia (Ton / Hora)
    const efficiencyValueEl = document.getElementById('efficiencyValue');
    if (efficiencyValueEl) {
      const efficiency = decimalHours > 0 ? (currentShiftTotal / decimalHours) : 0;
      efficiencyValueEl.textContent = Math.round(efficiency);
    }
  }

  function updateClock() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    const clockEl = document.getElementById('liveClock');
    if(clockEl) clockEl.textContent = now.toLocaleDateString('es-ES', options);
  }
  setInterval(updateClock, 1000);
  updateClock();

});