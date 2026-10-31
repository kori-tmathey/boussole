// Transport de la synchro PC ⇄ téléphone, partagé (main.js et version Android).
// L'état synchronisé part chiffré (AES-256) en pièce jointe sur un sujet ntfy privé : ntfy ne lit rien.
(function () {
  const L = typeof module !== 'undefined' ? require('./logic') : window.L;
  const base = cfg => (cfg.server || 'https://ntfy.sh').replace(/\/+$/, '');

  async function publish(cfg, data) {
    const box = await L.encrypt(cfg.key, { from: cfg.deviceId, at: new Date().toISOString(), view: L.syncView(data) });
    const r = await fetch(`${base(cfg)}/${cfg.topic}`, { method: 'PUT', headers: { Filename: 'boussole.txt', Tags: 'boussole-sync' }, body: L.b64(box) });
    if (!r.ok) throw new Error(`le serveur répond ${r.status}`);
  }

  // « Coucou, je suis de retour » : l'autre appareil renvoie alors son état.
  async function hello(cfg) {
    await fetch(`${base(cfg)}/${cfg.topic}`, { method: 'POST', headers: { Tags: 'boussole-hello' }, body: cfg.deviceId });
  }

  // Messages depuis `since` : états de l'autre appareil (déchiffrés) et nombre de « coucou » reçus.
  async function poll(cfg, since) {
    const r = await fetch(`${base(cfg)}/${cfg.topic}/json?poll=1&since=${since || 'all'}`);
    if (!r.ok) throw new Error(`le serveur répond ${r.status}`);
    const msgs = (await r.text()).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(m => m.event === 'message');
    const out = { lastId: msgs.length ? msgs[msgs.length - 1].id : since, states: [], hellos: 0 };
    for (const m of msgs) {
      if ((m.tags || []).includes('boussole-hello')) { if (m.message !== cfg.deviceId) out.hellos++; continue; }
      if (!m.attachment) continue;
      try {
        const res = await fetch(m.attachment.url);
        if (!res.ok) continue; // pièce jointe expirée (ntfy.sh les garde 3 h)
        const box = await L.decrypt(cfg.key, L.unb64((await res.text()).trim()));
        if (box.from !== cfg.deviceId) out.states.push(box);
      } catch { /* illisible : autre clé ou fichier abîmé */ }
    }
    return out;
  }

  const Sync = { publish, hello, poll };
  if (typeof module !== 'undefined') module.exports = Sync; else window.Sync = Sync;
})();
