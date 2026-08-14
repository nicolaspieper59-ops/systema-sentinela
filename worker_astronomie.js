function initialiserWorkerAstronomie() {
    if (typeof Worker === 'undefined') {
        ecrireLog("Erreur critique : Web Workers non supportés.");
        return;
    }
    
    astroWorker = new Worker('worker_astronomie.js');
    
    astroWorker.onmessage = function(e) {
        const data = e.data;
        
        // Validation stricte du statut de préparation du worker
        if (data.status === 'WASM_READY' || data.type === 'READY') {
            document.getElementById('lbl-worker-status').innerText = "ACTIF (DÉPÔT STRICT)";
            document.getElementById('lbl-worker-status').style.color = "var(--neon-green)";
            ecrireLog("Worker Astronomie lié aux modules VSOP2013 / ELP-2000.");
        } 
        
        // Traitement des éphémérides calculées
        else if (data.type === 'RESULTS' && data.results) {
            const resMap = data.results;
            const astres = ['soleil', 'lune', 'mercure', 'venus', 'mars', 'jupiter', 'saturne', 'uranus', 'neptune'];
            
            astres.forEach(astre => {
                if (resMap[astre]) {
                    const obj = resMap[astre];
                    document.getElementById(`az-${astre}`).innerText = `${obj.azimuth.toFixed(2)}°`;
                    document.getElementById(`el-${astre}`).innerText = `${obj.elevation.toFixed(2)}°`;
                    document.getElementById(`dist-${astre}`).innerText = `${Math.round(obj.distance).toLocaleString()} km`;
                    
                    const statusEl = document.getElementById(`status-${astre}`);
                    if (statusEl) {
                        statusEl.innerText = "SYNCHRONISÉ";
                        statusEl.style.color = "var(--neon-green)";
                    }
                }
            });
        }
        else if (data.type === 'ERROR') {
            ecrireLog(`Erreur Worker calcul : ${data.message}`);
        }
    };

    astroWorker.onerror = function(err) {
        ecrireLog(`Erreur critique thread Worker : ${err.message} (Vérifier la présence des fichiers .js dans le répertoire racine).`);
    };
                                                                          }
