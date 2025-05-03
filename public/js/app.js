// Wi-Fi Field Survey Application - Frontend JavaScript

// API Configuration
const API_BASE_URL = '/api';

// Global variables
let currentSession = null;
let currentPoints = [];
let currentPointData = null;
let temporaryPoint = null;
let charts = {};

// DOM Elements
const screens = {
    sessions: document.getElementById('sessions-screen'),
    survey: document.getElementById('survey-screen'),
    results: document.getElementById('results-screen')
};

const navLinks = {
    sessions: document.getElementById('nav-sessions'),
    survey: document.getElementById('nav-survey'),
    results: document.getElementById('nav-results')
};

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    // Navigation event listeners
    navLinks.sessions.addEventListener('click', showSessionsScreen);
    navLinks.survey.addEventListener('click', () => {
        if (currentSession) {
            showSurveyScreen();
        } else {
            alert('Please select a session first');
            showSessionsScreen();
        }
    });
    navLinks.results.addEventListener('click', () => {
        if (currentSession) {
            showResultsScreen();
        } else {
            alert('Please select a session first');
            showSessionsScreen();
        }
    });

    // Sessions screen event listeners
    document.getElementById('create-session-btn').addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('create-session-modal'));
        modal.show();
    });

    document.getElementById('map-image').addEventListener('change', previewMapImage);
    document.getElementById('save-session-btn').addEventListener('click', createSession);
    
    // Survey screen event listeners
    document.getElementById('back-to-sessions-btn').addEventListener('click', showSessionsScreen);
    document.getElementById('view-results-btn').addEventListener('click', showResultsScreen);
    document.getElementById('survey-map-container').addEventListener('click', handleMapClick);
    document.getElementById('start-scan-btn').addEventListener('click', startScan);
    
    // Results screen event listeners
    document.getElementById('back-to-survey-btn').addEventListener('click', showSurveyScreen);
    
    // Load sessions on startup
    loadSessions();
});

// ----- Session Management -----

// Load all sessions from the API
async function loadSessions() {
    try {
        const response = await fetch(`${API_BASE_URL}/sessions`);
        const data = await response.json();
        
        const noSessionsMessage = document.getElementById('no-sessions-message');
        const sessionsListItems = document.getElementById('sessions-list-items');
        
        if (data.sessions && data.sessions.length > 0) {
            noSessionsMessage.style.display = 'none';
            sessionsListItems.innerHTML = '';
            
            data.sessions.forEach(sessionId => {
                fetchSessionDetails(sessionId);
            });
        } else {
            noSessionsMessage.style.display = 'block';
            sessionsListItems.innerHTML = '';
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
        alert('Failed to load sessions. Please check if the server is running.');
    }
}

// Fetch details for a specific session
async function fetchSessionDetails(sessionId) {
    try {
        const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`);
        const data = await response.json();
        
        if (data.id) {
            addSessionToList(data);
        }
    } catch (error) {
        console.error(`Error fetching session ${sessionId}:`, error);
    }
}

// Add a session to the sessions list
function addSessionToList(session) {
    const sessionsListItems = document.getElementById('sessions-list-items');
    
    const sessionElement = document.createElement('a');
    sessionElement.href = '#';
    sessionElement.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
    sessionElement.dataset.sessionId = session.id;
    
    const pointsCount = session.points ? session.points.length : 0;
    
    sessionElement.innerHTML = `
        <div>
            <h5 class="mb-1">${session.metadata.name || 'Unnamed Session'}</h5>
            <small class="text-muted">ID: ${session.id}</small>
        </div>
        <div>
            <span class="badge bg-primary rounded-pill">${pointsCount} Points</span>
            <button class="btn btn-sm btn-danger delete-session-btn ms-2">
                <i class="bi bi-trash"></i>
            </button>
        </div>
    `;
    
    sessionElement.addEventListener('click', (e) => {
        if (!e.target.closest('.delete-session-btn')) {
            selectSession(session.id);
        }
    });
    
    const deleteButton = sessionElement.querySelector('.delete-session-btn');
    deleteButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteSession(session.id);
    });
    
    sessionsListItems.appendChild(sessionElement);
}

// Select a session and show the survey screen
async function selectSession(sessionId) {
    try {
        const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`);
        const data = await response.json();
        
        currentSession = data;
        currentPoints = data.points || [];
        
        document.getElementById('survey-session-name').textContent = data.metadata.name || 'Unnamed Session';
        document.getElementById('results-session-name').textContent = data.metadata.name || 'Unnamed Session';
        
        // Load map image
        const surveyMap = document.getElementById('survey-map');
        const resultsMap = document.getElementById('results-map');
        
        if (data.has_map) {
            const mapUrl = `${API_BASE_URL}/sessions/${sessionId}/map?t=${Date.now()}`; // Cache-busting
            surveyMap.src = mapUrl;
            resultsMap.src = mapUrl;
        } else {
            // Use a placeholder if no map is available
            surveyMap.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjhmOWZhIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzZjNzU3ZCI+Tm8gTWFwIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
            resultsMap.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjhmOWZhIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzZjNzU3ZCI+Tm8gTWFwIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
        }
        
        showSurveyScreen();
    } catch (error) {
        console.error(`Error selecting session ${sessionId}:`, error);
        alert('Failed to load session details.');
    }
}

// Preview map image in the create session modal
function previewMapImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const previewContainer = document.getElementById('map-preview-container');
            const previewImage = document.getElementById('map-preview');
            
            previewImage.src = e.target.result;
            previewContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

// Create a new session
async function createSession() {
    const sessionName = document.getElementById('session-name').value;
    const mapImageInput = document.getElementById('map-image');
    
    if (!sessionName || !mapImageInput.files.length) {
        alert('Please provide a session name and map image.');
        return;
    }
    
    try {
        // Read the map image as a data URL
        const file = mapImageInput.files[0];
        const reader = new FileReader();
        
        reader.onload = async function(e) {
            const mapImageData = e.target.result;
            
            const sessionData = {
                name: sessionName,
                map_image: mapImageData
            };
            
            try {
                const response = await fetch(`${API_BASE_URL}/sessions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(sessionData)
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Close the modal
                    const modal = bootstrap.Modal.getInstance(document.getElementById('create-session-modal'));
                    modal.hide();
                    
                    // Reset the form
                    document.getElementById('create-session-form').reset();
                    document.getElementById('map-preview-container').style.display = 'none';
                    
                    // Reload sessions
                    loadSessions();
                    
                    // Select the newly created session
                    selectSession(data.id);
                } else {
                    alert('Failed to create session.');
                }
            } catch (error) {
                console.error('Error creating session:', error);
                alert('Failed to create session. Please try again.');
            }
        };
        
        reader.readAsDataURL(file);
    } catch (error) {
        console.error('Error reading map image:', error);
        alert('Failed to read map image. Please try again.');
    }
}

// Delete a session
async function deleteSession(sessionId) {
    if (confirm('Are you sure you want to delete this session? This action cannot be undone.')) {
        try {
            const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (currentSession && currentSession.id === sessionId) {
                    currentSession = null;
                    currentPoints = [];
                    showSessionsScreen();
                }
                
                loadSessions();
            } else {
                alert('Failed to delete session.');
            }
        } catch (error) {
            console.error(`Error deleting session ${sessionId}:`, error);
            alert('Failed to delete session. Please try again.');
        }
    }
}

// ----- Survey Functions -----

// Handle map click to add a survey point
function handleMapClick(event) {
    if (!currentSession) {
        return;
    }
    
    const mapContainer = document.getElementById('survey-map-container');
    const mapRect = mapContainer.getBoundingClientRect();
    
    // Calculate position relative to the map container
    const x = ((event.clientX - mapRect.left) / mapRect.width) * 100;
    const y = ((event.clientY - mapRect.top) / mapRect.height) * 100;
    
    // Ignore clicks on existing points
    if (event.target.classList.contains('survey-point')) {
        return;
    }
    
    // Create a temporary point at the clicked position
    temporaryPoint = {
        x,
        y,
        element: createPointElement(x, y, 'point-inactive')
    };
    
    mapContainer.appendChild(temporaryPoint.element);
    
    // Show the point name modal
    const pointNameModal = new bootstrap.Modal(document.getElementById('point-name-modal'));
    pointNameModal.show();
}

// Create a point element and add it to the map
function createPointElement(x, y, statusClass, name = '') {
    const pointElement = document.createElement('div');
    pointElement.className = `survey-point ${statusClass}`;
    pointElement.style.left = `${x}%`;
    pointElement.style.top = `${y}%`;
    
    if (name) {
        const labelElement = document.createElement('div');
        labelElement.className = 'point-label';
        labelElement.style.left = `${x}%`;
        labelElement.style.top = `${y - 5}%`;
        labelElement.textContent = name;
        
        return [pointElement, labelElement];
    }
    
    return pointElement;
}

// Start the scanning process for a point
async function startScan() {
    if (!temporaryPoint) {
        return;
    }
    
    const pointName = document.getElementById('point-name').value;
    if (!pointName) {
        alert('Please provide a name for the survey point.');
        return;
    }
    
    try {
        // Close the modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('point-name-modal'));
        modal.hide();
        
        // Reset the form
        document.getElementById('point-name-form').reset();
        
        // Remove the temporary point
        if (temporaryPoint.element.parentNode) {
            temporaryPoint.element.parentNode.removeChild(temporaryPoint.element);
        }
        
        // Create a new point with the provided name
        const pointId = Date.now().toString(); // Use timestamp as ID
        const point = {
            id: pointId,
            name: pointName,
            x: temporaryPoint.x,
            y: temporaryPoint.y,
            status: 'SCAN_ACTIVE'
        };
        
        // Create point elements with label
        const [pointElement, labelElement] = createPointElement(point.x, point.y, 'point-active', point.name);
        
        // Add the elements to the map
        const mapContainer = document.getElementById('survey-map-container');
        mapContainer.appendChild(pointElement);
        mapContainer.appendChild(labelElement);
        
        // Start the scan on the server
        const response = await fetch(`${API_BASE_URL}/sessions/${currentSession.id}/points/${pointId}/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: point.name,
                x: point.x,
                y: point.y
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Add point to the current points array
            currentPoints.push(point);
            
            // Start polling for scan status
            pollScanStatus(currentSession.id, pointId, pointElement, labelElement);
        } else {
            alert('Failed to start scan. Please try again.');
            
            // Remove the point elements
            mapContainer.removeChild(pointElement);
            mapContainer.removeChild(labelElement);
        }
    } catch (error) {
        console.error('Error starting scan:', error);
        alert('Failed to start scan. Please try again.');
    }
}

// Poll the server for scan status updates
function pollScanStatus(sessionId, pointId, pointElement, labelElement) {
    const pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/points/${pointId}/status`);
            const data = await response.json();
            
            const pointIndex = currentPoints.findIndex(p => p.id === pointId);
            if (pointIndex >= 0) {
                currentPoints[pointIndex].status = data.status;
            }
            
            if (data.status === 'SCAN_DONE') {
                // Update point appearance
                pointElement.className = 'survey-point point-done';
                
                // Stop polling
                clearInterval(pollInterval);
            } else if (data.status === 'SCAN_INACTIVE') {
                // Scan failed or was cancelled
                pointElement.className = 'survey-point point-inactive';
                
                // Stop polling
                clearInterval(pollInterval);
            }
        } catch (error) {
            console.error(`Error polling scan status for point ${pointId}:`, error);
            clearInterval(pollInterval);
        }
    }, 1000); // Poll every second
}

// Render all survey points on the map
function renderSurveyPoints() {
    if (!currentSession || !currentPoints.length) {
        return;
    }
    
    const surveyMapContainer = document.getElementById('survey-map-container');
    const resultsMapContainer = document.getElementById('results-map-container');
    
    // Clear existing points
    const existingPoints = document.querySelectorAll('.survey-point, .point-label');
    existingPoints.forEach(el => el.parentNode && el.parentNode.removeChild(el));
    
    // Add points to both maps
    currentPoints.forEach(point => {
        const statusClass = point.status === 'SCAN_ACTIVE' ? 'point-active' : 
                           (point.status === 'SCAN_DONE' ? 'point-done' : 'point-inactive');
        
        // Add to survey map
        const [surveyPointElement, surveyLabelElement] = createPointElement(point.x, point.y, statusClass, point.name);
        surveyMapContainer.appendChild(surveyPointElement);
        surveyMapContainer.appendChild(surveyLabelElement);
        
        // Add to results map with click handler
        const [resultsPointElement, resultsLabelElement] = createPointElement(point.x, point.y, statusClass, point.name);
        resultsPointElement.addEventListener('click', () => {
            if (point.status === 'SCAN_DONE') {
                loadPointResults(currentSession.id, point.id, point.name);
            } else {
                alert('Scan is not complete for this point.');
            }
        });
        
        resultsMapContainer.appendChild(resultsPointElement);
        resultsMapContainer.appendChild(resultsLabelElement);
    });
}

// ----- Results Functions -----

// Load and display results for a specific point
async function loadPointResults(sessionId, pointId, pointName) {
    try {
        const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/points/${pointId}/results`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        currentPointData = data;
        
        // Display the point name
        document.getElementById('point-results-name').textContent = pointName;
        
        // Show the results card
        document.getElementById('point-results-card').style.display = 'block';
        
        // Update the UI with the results
        updateResultsSummary(data);
        updateChannelMetrics(data);
        updateResultsCharts(data);
        
        // Scroll to the results card
        document.getElementById('point-results-card').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error(`Error loading results for point ${pointId}:`, error);
        alert('Failed to load scan results. The scan may not be complete yet.');
    }
}

// Update the summary tab with best channels
function updateResultsSummary(data) {
    if (!data || !data.channels) {
        return;
    }
    
    // Get channels by band
   const channels24GHz = Object.keys(data.channels).filter(ch => ch.startsWith('2.4_'));
   const channels5GHz = Object.keys(data.channels).filter(ch => ch.startsWith('5_'));
   const channels6GHz = Object.keys(data.channels).filter(ch => ch.startsWith('6_'));

    
    // Get channel scores and sort
    const channelScores24GHz = channels24GHz
        .filter(ch => data.channels[ch])
        .map(ch => ({
          channelKey: ch,
          channel: ch.split('_')[1],
          score: data.channels[ch].score
        }))
        .sort((a, b) => b.score - a.score);
    
    const channelScores5GHz = channels5GHz
        .filter(ch => data.channels[ch])
        .map(ch => ({
          channelKey: ch,
          channel: ch.split('_')[1],
          score: data.channels[ch].score
        }))
        .sort((a, b) => b.score - a.score);

    // Get channel scores and sort for 6GHz
   const channelScores6GHz = channels6GHz
       .map(ch => ({
           channelKey: ch,
           channel: ch.split('_')[1],
           score: data.channels[ch].score
       }))
       .sort((a, b) => b.score - a.score);
    
    // Update the best channels tables
    const bestChannels24Container = document.getElementById('best-channels-24');
    const bestChannels5Container = document.getElementById('best-channels-5');
    const bestChannels6Container = document.getElementById('best-channels-6');
    
    bestChannels24Container.innerHTML = '';
    bestChannels5Container.innerHTML = '';
    bestChannels6Container.innerHTML = '';
    
    // Display top 5 channels for each band (or fewer if not available)
    const top5Channels24 = channelScores24GHz.slice(0, 5);
    const top5Channels5 = channelScores5GHz.slice(0, 5);
    const top5Channels6 = channelScores6GHz.slice(0, 5);
    
    top5Channels24.forEach(({ channel, score, channelKey }) => {
        const scoreClass = score >= 70 ? 'score-good' : (score >= 40 ? 'score-medium' : 'score-bad');
        bestChannels24Container.innerHTML += `
            <tr class="${scoreClass}">
                <td>${channel}</td>
                <td>${score.toFixed(1)}</td>
            </tr>
        `;
    });
    
    top5Channels5.forEach(({ channel, score, channelKey }) => {
        const scoreClass = score >= 70 ? 'score-good' : (score >= 40 ? 'score-medium' : 'score-bad');
        bestChannels5Container.innerHTML += `
            <tr class="${scoreClass}">
                <td>${channel}</td>
                <td>${score.toFixed(1)}</td>
            </tr>
        `;
    });
    top5Channels6.forEach(({ channel, score, channelKey }) => {
        const scoreClass = score >= 70 ? 'score-good' : (score >= 40 ? 'score-medium' : 'score-bad');
        bestChannels6Container.innerHTML += `
            <tr class="${scoreClass}">
                <td>${channel}</td>
                <td>${score.toFixed(1)}</td>
            </tr>
        `;
    });
}

// Update the channels tab with detailed metrics
function updateChannelMetrics(data) {
    if (!data || !data.channels) {
        return;
    }
    
    const channelMetricsContainer = document.getElementById('channel-metrics');
    channelMetricsContainer.innerHTML = '';
    
    // Sort channels numerically
    const sortedChannels = Object.keys(data.channels).sort((a, b) => {
        const aBand = a.split('_')[0];
        const bBand = b.split('_')[0];

        // 最初に帯域でソート
        if (aBand !== bBand) {
            // 帯域の優先順位: 2.4, 5, 6
            if (aBand === '2.4') return -1;
            if (bBand === '2.4') return 1;
            if (aBand === '5') return -1;
            if (bBand === '5') return 1;
            return 0;
        }

        // 同じ帯域内ではチャネル番号でソート
        const aChannel = parseInt(a.split('_')[1]);
        const bChannel = parseInt(b.split('_')[1]);
        return aChannel - bChannel;
    });
    sortedChannels.forEach(channelKey => {
        const metrics = data.channels[channelKey];
        const [band, channel] = channelKey.split('_');
        const scoreClass = metrics.score >= 70 ? 'score-good' : (metrics.score >= 40 ? 'score-medium' : 'score-bad');
        
        channelMetricsContainer.innerHTML += `
            <tr>
                <td>${band} GHz</td>
                <td>${channel}</td>
                <td>${metrics.ap_count}</td>
                <td>${metrics.strong_ap_count}</td>
                <td>${metrics.channel_busy_rate.toFixed(1)}</td>
                <td>${metrics.channel_usage_rate.toFixed(1)}</td>
                <td class="${scoreClass}">${metrics.score.toFixed(1)}</td>
            </tr>
        `;
    });
}

// Update the charts tab with visual representations
function updateResultsCharts(data) {
    if (!data || !data.channels) {
        return;
    }
    
    // Destroy existing charts to prevent memory leaks
    if (charts.chart24ghz) {
        charts.chart24ghz.destroy();
    }
    
    if (charts.chart5ghz) {
        charts.chart5ghz.destroy();
    }
    
    // Get channels by band
    //const channels24GHz = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
    //const channels5GHz = ['36', '40', '44', '48', '52', '56', '60', '64', '100', '104', '108', '112', 
    //                     '116', '120', '124', '128', '132', '136', '140', '144', '149', '153', 
    //                     '157', '161', '165', '169', '173', '177'];
   const channels24GHz = Object.keys(data.channels).filter(ch => ch.startsWith('2.4_'));
   const channels5GHz = Object.keys(data.channels).filter(ch => ch.startsWith('5_'));

     // Chart configuration
    const chartConfig = {
        scales: {
            y: {
                beginAtZero: true,
                max: 100,
                title: {
                    display: true,
                    text: 'Score'
                }
            },
            x: {
                title: {
                    display: true,
                    text: 'Channel'
                }
            }
        },
        plugins: {
            legend: {
                display: false
            }
        }
    };
    
    // Prepare data for 2.4GHz chart
    const chart24data = {
        labels: channels24GHz.map(ch => ch.split('_')[1]),
        datasets: [
            {
                label: 'Channel Score',
                data: channels24GHz.map(ch => data.channels[ch].score),
                backgroundColor: channels24GHz
                  .map(ch => {
                    const score = data.channels[ch].score;
                    return score >= 70 ? 'rgba(40, 167, 69, 0.7)' : 
                           (score >= 40 ? 'rgba(255, 193, 7, 0.7)' : 'rgba(220, 53, 69, 0.7)');
                }),
                borderColor: 'rgba(0, 0, 0, 0.1)',
                borderWidth: 1
            }
        ]
    };
    
    // Prepare data for 5GHz chart
    const chart5data = {
        labels: channels5GHz.map(ch => ch.split('_')[1]),
        datasets: [
            {
                label: 'Channel Score',
                data: channels5GHz.map(ch => data.channels[ch].score),
                backgroundColor: channels5GHz
                .map(ch => {
                    const score = data.channels[ch].score;
                    return score >= 70 ? 'rgba(40, 167, 69, 0.7)' : 
                           (score >= 40 ? 'rgba(255, 193, 7, 0.7)' : 'rgba(220, 53, 69, 0.7)');
                }),
                borderColor: 'rgba(0, 0, 0, 0.1)',
                borderWidth: 1
            }
        ]
    };
    
    // 新しく6GHzチャート用のデータを追加
    if (Object.keys(data.channels).some(ch => ch.startsWith('6_'))) {
        const channels6GHz = Object.keys(data.channels).filter(ch => ch.startsWith('6_'));
 
        const chart6data = {
            labels: channels6GHz.map(ch => ch.split('_')[1]),
            datasets: [
                {
                    label: 'Channel Score',
                    data: channels6GHz.map(ch => data.channels[ch].score),
                    backgroundColor: channels6GHz.map(ch => {
                        const score = data.channels[ch].score;
                        return score >= 70 ? 'rgba(40, 167, 69, 0.7)' :
                               (score >= 40 ? 'rgba(255, 193, 7, 0.7)' : 'rgba(220, 53, 69, 0.7)');
                    }),
                    borderColor: 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 1
                }
            ]
        };
 
        // HTMLに6GHzチャート用の要素を追加（まだなければ）
        if (!document.getElementById('chart-6ghz')) {
            const chartsRow = document.querySelector('#charts .row');
            const chartCol = document.createElement('div');
            chartCol.className = 'col-md-6 mb-3';
            chartCol.innerHTML = `
                <div class="card">
                    <div class="card-header">6 GHz Channel Scores</div>
                    <div class="card-body">
                        <div class="chart-container">
                            <canvas id="chart-6ghz"></canvas>
                        </div>
                    </div>
                </div>
            `;
            chartsRow.appendChild(chartCol);
        }
 
        // 6GHzチャートを作成
        const ctx6 = document.getElementById('chart-6ghz').getContext('2d');
        if (charts.chart6ghz) {
            charts.chart6ghz.destroy();
        }
        charts.chart6ghz = new Chart(ctx6, {
            type: 'bar',
            data: chart6data,
            options: chartConfig
        });
    }
   
    // Create 2.4GHz chart
    const ctx24 = document.getElementById('chart-24ghz').getContext('2d');
    charts.chart24ghz = new Chart(ctx24, {
        type: 'bar',
        data: chart24data,
        options: chartConfig
    });
    
    // Create 5GHz chart
    const ctx5 = document.getElementById('chart-5ghz').getContext('2d');
    charts.chart5ghz = new Chart(ctx5, {
        type: 'bar',
        data: chart5data,
        options: chartConfig
    });
}

// ----- Screen Management -----

// Show the sessions screen
function showSessionsScreen() {
    screens.sessions.style.display = 'block';
    screens.survey.style.display = 'none';
    screens.results.style.display = 'none';
    
    navLinks.sessions.classList.add('active');
    navLinks.survey.classList.remove('active');
    navLinks.results.classList.remove('active');
    
    // Reload sessions when showing the screen
    loadSessions();
}

// Show the survey screen
function showSurveyScreen() {
    if (!currentSession) {
        showSessionsScreen();
        return;
    }
    
    screens.sessions.style.display = 'none';
    screens.survey.style.display = 'block';
    screens.results.style.display = 'none';
    
    navLinks.sessions.classList.remove('active');
    navLinks.survey.classList.add('active');
    navLinks.results.classList.remove('active');
    
    // Render survey points
    renderSurveyPoints();
}

// Show the results screen
function showResultsScreen() {
    if (!currentSession) {
        showSessionsScreen();
        return;
    }
    
    screens.sessions.style.display = 'none';
    screens.survey.style.display = 'none';
    screens.results.style.display = 'block';
    
    navLinks.sessions.classList.remove('active');
    navLinks.survey.classList.remove('active');
    navLinks.results.classList.add('active');
    
    // Render survey points on the results map
    renderSurveyPoints();
    
    // Hide the results card until a point is selected
    document.getElementById('point-results-card').style.display = 'none';
}
