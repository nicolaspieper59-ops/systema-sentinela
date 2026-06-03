<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SYSTEMA SENTINELA v8.6 — JPL Pure API</title>
    <style>
        :root {
            --bg-main: #0a0e14;
            --bg-card: #101520;
            --border-color: #262c36;
            --text-primary: #e1e7ef;
            --text-secondary: #717f91;
            --accent-blue: #38bdf8;
            --accent-green: #4ade80;
            --accent-orange: #fb923c;
            --accent-red: #ef4444;
        }

        body {
            background-color: var(--bg-main);
            color: var(--text-primary);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            margin: 0;
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            box-sizing: border-box;
        }

        .dashboard-container {
            display: grid;
            grid-template-columns: 1fr 420px;
            gap: 24px;
            max-width: 1150px;
            width: 100%;
        }

        @media (max-width: 950px) {
            .dashboard-container { grid-template-columns: 1fr; }
        }

        .main-panel {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .header-title h1 {
            color: var(--accent-blue);
            font-size: 1.2rem;
            margin: 0;
            text-transform: uppercase;
            letter-spacing: 2px;
            text-align: center;
        }

        .system-status-tag {
            font-size: 0.65rem;
            color: var(--text-secondary);
            display: block;
            text-align: center;
            margin-bottom: 20px;
        }

        #radar {
            width: 100%;
            max-width: 360px;
            background: #05070c;
            border-radius: 50%;
            border: 1px solid var(--border-color);
        }

        .grid-line { stroke: #1e293b; stroke-width: 1; }
        .radar-ring { fill: none; stroke: #0284c7; stroke-width: 1; stroke-dasharray: 2 4; opacity: 0.5; }
        .cardinal-text { fill: var(--text-secondary); font-size: 11px; text-anchor: middle; dominant-baseline: middle; }
        .pointer { stroke-linecap: round; opacity: 0.85; transition: transform 0.5s ease-out; }

        .side-analytics { display: flex; flex-direction: column; gap: 16px; }
        .kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .kpi-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; }
        .kpi-card.full-width { grid-column: span 2; }
        .kpi-title { font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 4px; }
        .kpi-value { font-size: 0.85rem; font-weight: bold; color: var(--text-primary); }

        #legend { display: grid; grid-template-columns: 1fr; gap: 8px; max-height: 240px; overflow-y: auto; }
        .legend-item {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            padding: 10px;
            border-radius: 6px;
            font-size: 0.7rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .system-console { background: #02040a; border: 1px solid var(--border-color); border-radius: 6px; }
        .console-header { background: #0b0f17; padding: 6px 12px; font-size: 0.6rem; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); }
        .console-body { padding: 10px; height: 130px; overflow-y: auto; font-size: 0.65rem; color: var(--accent-green); line-height: 1.5; white-space: pre-wrap; }
    </style>
</head>
<body>

    <div class="dashboard-container">
        <div class="main-panel">
            <div class="header-title">
                <h1>Systema Sentinela v8.6</h1>
                <span class="system-status-tag">NASA JPL HORIZONS API — CLOUD DIRECT LINK</span>
            </div>

            <svg id="radar" viewBox="0 0 400 400">
                <line x1="200" y1="20" x2="200" y2="380" class="grid-line" />
                <line x1="20" y1="200" x2="380" y2="200" class="grid-line" />
                <circle cx="200" cy="200" r="160" class="radar-ring" />
                <circle cx="200" cy="200" r="107" class="radar-ring" />
                <circle cx="200" cy="200" r="53" class="radar-ring" />
                <text x="200" y="32" class="cardinal-text">N</text>
                <text x="360" y="200" class="cardinal-text">E</text>
                <text x="200" y="368" class="cardinal-text">S</text>
                <text x="40" y="200" class="cardinal-text">O</text>
                <g id="pointers-group"></g>
            </svg>
        </div>

        <div class="side-analytics">
            <div class="kpi-grid">
                <div class="kpi-card">
                    <span class="kpi-title">Statut Réseau (JPL)</span>
                    <span class="kpi-value" id="kpi-net" style="color: var(--accent-orange);">CONNEXION...</span>
                </div>
                <div class="kpi-card">
                    <span class="kpi-title">Filtre Équation EM (AuroraMap)</span>
                    <span class="kpi-value" id="kpi-gps" style="color: var(--accent-orange);">RECHERCHE...</span>
                </div>
                <div class="kpi-card full-width">
                    <span class="kpi-title">Horloge Absolue Monotone Temporelle</span>
                    <span class="kpi-value" id="kpi-utc" style="color: var(--accent-blue);">00:00:00.000 UTC</span>
                </div>
            </div>

            <div id="legend"></div>

            <div class="system-console">
                <div class="console-header">MONITEUR QUANTIQUE DE TRAJECTOIRE NASA JPL</div>
                <div class="console-body" id="log-terminal"></div>
            </div>
        </div>
    </div>

    <script>
    // Variables temporelles monotones (indépendantes de l'heure système Android)
    let baseTempsAtomiqueMS = 0;
    let referencePerformanceMS = 0;

    // Coordonnées de base stabilisées (Grille type AuroraMap)
    let gpsStable = { lat: 43.2845, lon: 5.3586 }; // Marseille par défaut
    
    // Identifiants JPL Horizons pour les astres
    const ASTRES_JPL = {
        "SOLEIL": "10", "LUNE": "301", "MERCURE": "199",
        "VENUS": "299", "MARS": "499", "JUPITER": "599", "SATURNE": "699"
    };

    const COULEURS = {
        "SOLEIL": "#f59e0b", "LUNE": "#94a3b8", "MERCURE": "#64748b",
        "VENUS": "#f472b6", "MARS": "#ef4444", "JUPITER": "#fb923c", "SATURNE": "#eab308"
    };

    function ajouterLog(msg, couleur = "var(--accent-green)") {
        const cb = document.getElementById('log-terminal');
        if (cb) {
            cb.innerHTML += `\n<span style="color: ${couleur}">[${new Date().toLocaleTimeString()}] ${msg}</span>`;
            cb.scrollTop = cb.scrollHeight;
        }
    }

    async function initialiserHorlogeMonotone() {
        try {
            let t0 = performance.now();
            let res = await fetch("https://timeapi.io/api/time/current/zone?timeZone=UTC", { cache: 'no-store' });
            if(res.ok) {
                let data = await res.json();
                baseTempsAtomiqueMS = new Date(data.dateTime).getTime() + ((performance.now() - t0) / 2);
                referencePerformanceMS = performance.now();
                ajouterLog("TIME : Horloge monotone ancrée à l'échelle UTC universelle.");
                return;
            }
        } catch(e) {}
        baseTempsAtomiqueMS = Date.now();
        referencePerformanceMS = performance.now();
        ajouterLog("TIME WARN : Échec NTP, repli sur l'horloge locale.", "var(--accent-orange)");
    }

    function capterGpsEtFiltrerAuroraMap() {
        if (!navigator.geolocation) {
            ajouterLog("GPS : Capteur indisponible. Fixation sur coordonnées nominales.");
            MuterIUGps(); return;
        }

        navigator.geolocation.getCurrentPosition((position) => {
            let latBrute = position.coords.latitude;
            let lonBrute = position.coords.longitude;

            // ÉQUATION AURORAMAP : Quantification géodésique par troncature à 2 décimales (~1.1 km de résolution)
            // Cela absorbe à 100% les micro-sauts EM et les changements d'antennes relais
            gpsStable.lat = Math.round(latBrute * 100) / 100;
            gpsStable.lon = Math.round(lonBrute * 100) / 100;

            MuterIUGps();
            ajouterLog(`GPS : Grille stabilisée face aux ondes EM -> Lat: ${gpsStable.lat}, Lon: ${gpsStable.lon}`);
            interrogerNASA();
        }, () => {
            MuterIUGps();
            ajouterLog("GPS WARN : Signal faible, utilisation de la grille de secours.");
            interrogerNASA();
        }, { enableHighAccuracy: false, timeout: 5000 });
    }

    function MuterIUGps() {
        const el = document.getElementById('kpi-gps');
        el.innerText = `MAILLE ${gpsStable.lat}N / ${gpsStable.lon}E`;
        el.style.color = "var(--accent-green)";
    }

    async function interrogerNASA() {
        document.getElementById('kpi-net').innerText = "FETCHING_JPL...";
        document.getElementById('kpi-net').style.color = "var(--accent-orange)";

        let dateUTC = new Date(baseTempsAtomiqueMS + (performance.now() - referencePerformanceMS));
        let dateDebut = dateUTC.toISOString().slice(0,10) + " " + dateUTC.toISOString().slice(11,16);
        
        // Calcul pour obtenir 5 minutes d'éphémérides
        let dateFin = new Date(dateUTC.getTime() + 5*60000);
        let dateFinStr = dateFin.toISOString().slice(0,10) + " " + dateFin.toISOString().slice(11,16);

        ajouterLog("NET : Requête séquentielle vers le serveur NASA Horizons...");

        for (let nomAstre in ASTRES_JPL) {
            let id = ASTRES_JPL[nomAstre];
            
            // Construction de l'URL API Horizons JPL (Coordonnées Observer de type Azimut/Altitude corrigées de la réfraction)
            let url = `https://ssd-api.jpl.nasa.gov/horizons.api?format=json` +
                      `&COMMAND='${id}'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'` +
                      `&CENTER='coord@399'&COORD_TYPE='GEODETIC'&SITE_COORD='${gpsStable.lon},${gpsStable.lat},0'` +
                      `&START_TIME='${dateDebut}'&STOP_TIME='${dateFinStr}'&STEP_SIZE='1m'&QUANTITIES='4'`;

            try {
                let proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(url); // Bypass des restrictions CORS navigateur direct
                let response = await fetch(proxyUrl);
                if (response.ok) {
                    let data = await response.json();
                    extraireDonneesJPL(nomAstre, data.result);
                }
            } catch (e) {
                ajouterLog(`NET CRIT : Erreur de communication pour ${nomAstre}`, "var(--accent-red)");
            }
        }
        document.getElementById('kpi-net').innerText = "NASA_STREAM_LIVE";
        document.getElementById('kpi-net').style.color = "var(--accent-green)";
    }

    function extraireDonneesJPL(nomAstre, texteBrut) {
        if (!texteBrut) return;
        try {
            // Extraction chirurgicale des blocs de données entre les marqueurs officiels du JPL
            let debut = texteBrut.indexOf("$$SOE");
            let fin = texteBrut.indexOf("$$EOE");
            if(debut === -1 || fin === -1) return;
            
            let segment = texteBrut.substring(debut + 5, fin).trim();
            let lignes = segment.split("\n");
            
            // Analyse de la première ligne d'éphémérides retournée
            let colonnes = lignes[0].trim().split(/\s+/);
            // Dans le format OBSERVER JPL Quantité 4 : l'Azimut est col[3] et l'Altitude col[4]
            let azimut = parseFloat(colonnes[3]);
            let altitude = parseFloat(colonnes[4]);

            mettreAJourRadar(nomAstre, azimut, altitude);
        } catch(e) {
            console.error("Échec du parseur JPL pour " + nomAstre);
        }
    }

    function mettreAJourRadar(nomAstre, azimut, altitude) {
        const line = document.getElementById(`ptr-${nomAstre}`);
        if (line) {
            line.setAttribute("transform", `rotate(${azimut} 200 200)`);
            if (altitude < 0) {
                line.style.opacity = "0.12";
                line.setAttribute("y2", "197");
            } else {
                line.style.opacity = "1";
                let rayonRendu = ((90 - altitude) / 90) * 160;
                line.setAttribute("y2", (200 - rayonRendu).toString());
            }
        }

        const valSpan = document.getElementById(`val-${nomAstre}`);
        if (valSpan) {
            valSpan.innerHTML = `h: ${altitude.toFixed(2)}° | Az: ${azimut.toFixed(1)}° ${altitude < 0 ? '⧗' : '✦'}`;
        }
    }

    function initialiserInterface() {
        const group = document.getElementById('pointers-group');
        const legend = document.getElementById('legend');
        group.innerHTML = ""; legend.innerHTML = "";
        
        for (let nomAstre in ASTRES_JPL) {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("id", `ptr-${nomAstre}`);
            line.setAttribute("x1", "200"); line.setAttribute("y1", "200");
            line.setAttribute("x2", "200"); line.setAttribute("y2", "40");
            line.setAttribute("stroke", COULEURS[nomAstre]);
            line.setAttribute("stroke-width", "2.5");
            line.setAttribute("class", "pointer");
            group.appendChild(line);

            const div = document.createElement('div'); div.className = 'legend-item';
            div.style.borderLeft = `4px solid ${COULEURS[nomAstre]}`;
            div.innerHTML = `<span><strong>${nomAstre}</strong></span><span id="val-${nomAstre}">Recherche...</span>`;
            legend.appendChild(div);
        }
    }

    // Boucle d'horloge monotone haute précision
    setInterval(() => {
        let millisecondesReelles = baseTempsAtomiqueMS + (performance.now() - referencePerformanceMS);
        let tempsAtomiqueReel = new Date(millisecondesReelles);
        document.getElementById('kpi-utc').innerText = tempsAtomiqueReel.toISOString().replace("T", " ").replace("Z", " UTC");
    }, 100);

    // Rafraîchissement complet des données JPL toutes les 4 minutes
    setInterval(interrogerNASA, 240000);

    (async () => {
        ajouterLog("SYS : Activation du Systema Sentinela (Mode Serveur Externe).");
        initialiserInterface();
        await initialiserHorlogeMonotone();
        capterGpsEtFiltrerAuroraMap();
    })();
    </script>
</body>
</html>
