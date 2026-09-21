/**
 * SYSTEMA SENTINELA — GESTIONNAIRE MÉTÉO SENSORIEL & HYBRIDE HORS-LIGNE
 */
class MeteoBaroManager {
    constructor() {
        this.currentData = { tempC: 15.0, presHpa: 1013.25, source: 'DEFAULT' };
        this.lastCalibration = JSON.parse(localStorage.getItem('sentinela_meteo_calib')) || null;
        this.barometer = null;
        this.latestRawBaroHpa = null;

        this.initialiserCapteurBarometre();
    }

    initialiserCapteurBarometre() {
        if ('PressureSensor' in window) {
            try {
                this.barometer = new PressureSensor({ frequency: 1 });
                this.barometer.addEventListener('reading', () => {
                    // Lecture brute du capteur en hectopascals (hPa) sans lissage
                    this.latestRawBaroHpa = this.barometer.pressure;
                    if (!navigator.onLine) {
                        this.calculerFallbackHorsLigne();
                    }
                });
                this.barometer.start();
            } catch (err) {
                console.warn("[Météo] Capteur barométrique inaccessible :", err);
            }
        }
    }

    async acquerirDonneesApi(lat, lon) {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,surface_pressure`;
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error("Échec requête API Météo");

            const data = await res.json();
            const tempApi = data.current.temperature_2m;
            const presApi = data.current.surface_pressure;

            this.currentData = { tempC: tempApi, presHpa: presApi, source: 'API_LIVE' };

            // Enregistrement du point d'étalonnage pour le mode hors ligne
            if (this.latestRawBaroHpa) {
                this.lastCalibration = {
                    timestamp: Date.now(),
                    pApi: presApi,
                    pBaro: this.latestRawBaroHpa,
                    tApi: tempApi
                };
                localStorage.setItem('sentinela_meteo_calib', JSON.stringify(this.lastCalibration));
            }

            return this.currentData;
        } catch (err) {
            console.warn("[Météo] Mode hors ligne activé :", err.message);
            return this.calculerFallbackHorsLigne();
        }
    }

    calculerFallbackHorsLigne() {
        if (!this.lastCalibration || !this.latestRawBaroHpa) {
            this.currentData.source = 'DEFAULT_FALLBACK';
            return this.currentData;
        }

        const { pApi, pBaro, tApi } = this.lastCalibration;
        const pCurrentBaro = this.latestRawBaroHpa;

        // Comparaison multiple exponentielle différentielle brute (sans lissage)
        const ratioDiff = (pCurrentBaro - pBaro) / pBaro;
        const pEst = pApi * Math.exp(ratioDiff);

        // Correction adiabatique de la température
        const tKelvinApi = tApi + 273.15;
        const tKelvinEst = tKelvinApi * Math.pow(pEst / pApi, 0.286);
        const tEst = tKelvinEst - 273.15;

        this.currentData = {
            tempC: parseFloat(tEst.toFixed(2)),
            presHpa: parseFloat(pEst.toFixed(2)),
            source: 'OFFLINE_DIFFERENTIAL_EXP'
        };

        return this.currentData;
    }
}

export const meteoManager = new MeteoBaroManager();
