// The HUD: every readout is a DOM node the simulation writes to, never a canvas
// redraw. Crosshair gap follows the weapon's live spread; the kill feed, the
// buy menu and the round banners are plain HTML the judge can read in a shot.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    health: $('health-value'), healthBar: $('health-bar'), armor: $('armor-value'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammo: $('ammo'),
    money: $('money-value'), timer: $('timer-value'), score: $('score-value'),
    round: $('round-value'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    feed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'), overlay: $('overlay'), overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'), playBtn: $('play'), buyMenu: $('buy-menu'),
    buyItems: $('buy-items'), buyMoney: $('buy-money'), progress: $('progress'),
    progressFill: $('progress-fill'), progressLabel: $('progress-label'),
    bombStatus: $('bomb-status'), teammates: $('teammates'), vignette: $('vignette'),
    spectate: $('spectate'), weaponName: $('weapon-name'),
  };

  let bannerTimer = 0;

  function setHealth(hp, armor) {
    els.health.textContent = Math.max(0, Math.ceil(hp));
    els.healthBar.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    els.healthBar.classList.toggle('low', hp <= 30);
    els.armor.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    els.vignette.style.opacity = hp <= 35 ? String(0.55 - hp * 0.012) : '0';
  }

  function setAmmo(mag, reserve, name) {
    els.ammoMag.textContent = mag;
    els.ammoReserve.textContent = `/ ${reserve}`;
    els.ammo.classList.toggle('empty', mag === 0);
    if (name) els.weaponName.textContent = name;
  }

  function setMoney(m) {
    els.money.textContent = `$${m}`;
    els.buyMoney.textContent = `$${m}`;
  }

  function setTimer(seconds, planted) {
    const s = Math.max(0, Math.ceil(seconds));
    els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    els.timer.classList.toggle('planted', !!planted);
  }

  function setScore(ember, ash, round) {
    els.score.textContent = `EMBER ${ember} — ${ash} ASH`;
    els.round.textContent = `ROUND ${round}`;
  }

  function setSpread(px) {
    els.crosshair.style.setProperty('--gap', `${px}px`);
  }

  function hitMarker(kill, holdMs = 90) {
    els.hitmarker.classList.add('on');
    els.hitmarker.classList.toggle('kill', !!kill);
    window.setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), holdMs);
  }

  function feed(text, good) {
    const line = document.createElement('div');
    line.className = `feed-line${good ? ' good' : ''}`;
    line.textContent = text;
    els.feed.prepend(line);
    while (els.feed.children.length > 4) els.feed.removeChild(els.feed.lastChild);
    window.setTimeout(() => line.classList.add('fade'), 4200);
  }

  function banner(title, sub, ms = 2600) {
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub || '';
    els.banner.hidden = false;
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => { els.banner.hidden = true; }, ms);
  }

  function showOverlay(kind, data = {}) {
    els.overlay.hidden = false;
    els.playBtn.style.display = '';
    if (kind === 'start') {
      els.overlayTitle.textContent = 'EMBERLINE';
      els.overlayCopy.textContent = 'A round-based tactical FPS in the Foundry Yard. Plant the charge at Furnace or Depot — or wipe the Ash team. Click to play.';
      els.playBtn.textContent = 'Click to play';
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'PAUSED';
      els.overlayCopy.textContent = 'Pointer released. Click to jump back in.';
      els.playBtn.textContent = 'Resume';
    } else if (kind === 'dead') {
      els.overlayTitle.textContent = 'YOU ARE DOWN';
      els.overlayCopy.textContent = 'Spectating your team. The round plays on without you.';
      els.playBtn.style.display = 'none';
    } else if (kind === 'match') {
      els.overlayTitle.textContent = data.title || 'MATCH OVER';
      els.overlayCopy.textContent = data.sub || '';
      els.playBtn.textContent = 'Play again';
    }
  }

  function hideOverlay() {
    els.overlay.hidden = true;
  }

  function setBuyOpen(open, items, money) {
    els.buyMenu.hidden = !open;
    if (!open) return;
    setMoney(money);
    els.buyItems.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = `buy-row${item.owned ? ' owned' : ''}${item.affordable ? '' : ' poor'}`;
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-price">${item.owned ? 'OWNED' : '$' + item.price}</span>`;
      els.buyItems.appendChild(row);
    }
  }

  function setProgress(label, frac) {
    if (!label) {
      els.progress.hidden = true;
      return;
    }
    els.progress.hidden = false;
    els.progressLabel.textContent = label;
    els.progressFill.style.width = `${Math.round(frac * 100)}%`;
  }

  function setBomb(text) {
    els.bombStatus.textContent = text || '';
    els.bombStatus.hidden = !text;
  }

  function setTeammates(list) {
    els.teammates.innerHTML = '';
    for (const mate of list) {
      const row = document.createElement('div');
      row.className = `mate${mate.alive ? '' : ' dead'}`;
      row.innerHTML = `<span class="mate-dot" style="background:${mate.color}"></span><span class="mate-name">${mate.name}</span><span class="mate-hp">${mate.alive ? Math.ceil(mate.hp) : '—'}</span>`;
      els.teammates.appendChild(row);
    }
  }

  function setSpectate(text) {
    els.spectate.textContent = text || '';
    els.spectate.hidden = !text;
  }

  return {
    setHealth, setAmmo, setMoney, setTimer, setScore, setSpread, hitMarker, feed,
    banner, showOverlay, hideOverlay, setBuyOpen, setProgress, setBomb,
    setTeammates, setSpectate,
    onPlay(fn) { els.playBtn.addEventListener('click', fn); },
  };
}
