async function async_flux_charger() {
    try {
        const reponse = await fetch('flux_live.json', { cache: 'no-store' });
        if (!reponse.ok) throw new Error("flux_live.json introuvable.");
        const data = await reponse.json();
        
        // Transmission de l'étalonnage au Worker au lieu d'afficher du brut
        if (astroWorker) {
            astroWorker.postMessage({ type: 'INIT_CALIBRATION', payload: data });
        }
        ecrireLog("Étalonnage DE440s injecté dans le noyau de calcul.");
    } catch (e) {
        ecrireLog("Mode autonome activé (sans étalonnage externe).");
    }
}
