#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v9.1.0 — API TELEMETRIE TEMPS RÉEL
"""

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import json
import os

app = FastAPI(title="SENTINELA CONTROL PANEL")

# Code HTML/JS de l'interface graphique embarqué
HTML_INTERFACE = """
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>SYSTEMA SENTINELA — Live Control Panel</title>
    <style>
        body { background-color: #0d1117; color: #c9d1d9; font-family: 'Courier New', monospace; margin: 20px; }
        h1 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 15px; }
        .card-title { color: #8b949e; font-size: 0.9em; text-transform: uppercase; margin-bottom: 10px; }
        .value { font-size: 1.6em; color: #58a6ff; font-weight: bold; }
        .status { color: #2ea44f; animation: blink 2s infinite; }
        @keyframes blink { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
    </style>
</head>
<body>
    <h1>SYSTEMA SENTINELA <span class="status">● LIVE_STREAM</span></h1>
    <div id="timestamp" style="color: #8b949e;">Initialisation du flux...</div>

    <div class="grid">
        <div class="card">
            <div class="card-title">Position Récepteur (GPS)</div>
            <div id="gps-pos" class="value">0.0, 0.0</div>
            <div id="ecef-pos" style="font-size: 0.8em; margin-top: 5px; color: #8b949e;">ECEF: -</div>
        </div>
        <div class="card">
            <div class="card-title">Équation du Temps</div>
            <div id="eot" class="value">0.0000 min</div>
        </div>
        <div class="card">
            <div class="card-title">Azimut / Élévation Soleil</div>
            <div id="sun-coords" class="value">0° / 0°</div>
        </div>
        <div class="card">
            <div class="card-title">Distance Terre-Soleil</div>
            <div id="sun-dist" class="value">0.00e+00 m</div>
        </div>
    </div>

    <script>
        async function updateDashboard() {
            try {
                const response = await fetch('/data');
                const data = await response.json();
                
                document.getElementById('timestamp').innerText = "TRACÉ UTC : " + data.timestamp;
                document.getElementById('gps-pos').innerText = data.position_recepteur.latitude.toFixed(5) + "°N , " + data.position_recepteur.longitude.toFixed(5) + "°E";
                
                const ecef = data.position_recepteur.ecef;
                document.getElementById('ecef-pos').innerText = `X: ${ecef[0].toFixed(1)} | Y: ${ecef[1].toFixed(1)} | Z: ${ecef[2].toFixed(1)}`;
                
                document.getElementById('eot').innerText = data.astronomie.equation_of_time_min.toFixed(5) + " min";
                
                const sun = data.targets.soleil;
                document.getElementById('sun-coords').innerText = sun.azimut + "° / " + sun.elevation + "°";
                document.getElementById('sun-dist').innerText = sun.distance_m;
            } catch (err) {
                console.log("En attente du flux live...");
            }
        }
        setInterval(updateDashboard, 500); // Rafraîchissement matériel à 2Hz (toutes les 500ms)
    </script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
def read_root():
    return HTML_INTERFACE

@app.get("/data")
def get_data():
    path_flux = os.path.join(os.getcwd(), "flux_live.json")
    if os.path.exists(path_flux):
        with open(path_flux, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"status": "Waiting for stream engine"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8080)
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
import os

app = FastAPI()

@app.get("/", response_class=HTMLResponse)
def read_index():
    # Lit directement votre fichier index.html du dépôt
    with open("index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/data")
def get_data():
    if os.path.exists("flux_live.json"):
        with open("flux_live.json", "r", encoding="utf-8") as f:
            return json.load(f)
    return {"status": "offline"}
