(function () {
  const urlInput = document.getElementById('urlInput');
  const generateBtnEl = document.getElementById('generateBtn');
  const generateBtnTextEl = document.getElementById('generateBtnText');
  const generateStatusEl = document.getElementById('generateStatus');

  const summaryTitleEl = document.getElementById('summaryTitle');
  const summaryTextEl = document.getElementById('summaryText');
  const chaptersEl = document.getElementById('chapters');
  const hashtagsEl = document.getElementById('hashtags');
  const aiStatusEl = document.getElementById('aiStatus'); // ok om den inte finns

  function renderResult(data) {
    if (summaryTitleEl && data.title) {
      summaryTitleEl.textContent = data.title;
    }

    if (summaryTextEl && data.summary) {
      summaryTextEl.textContent = data.summary;
    }

    if (chaptersEl && Array.isArray(data.chapters)) {
      chaptersEl.innerHTML = '';
      data.chapters.forEach(function (ch) {
        const li = document.createElement('li');
        const time = ch.time || '';
        const title = ch.title || '';
        li.textContent = (time + ' ' + title).trim();
        chaptersEl.appendChild(li);
      });
    }

    if (hashtagsEl && Array.isArray(data.hashtags)) {
      hashtagsEl.innerHTML = '';
      data.hashtags.forEach(function (tag) {
        const span = document.createElement('span');
        span.className = 'hashtag-pill';
        span.textContent = '#' + String(tag).replace(/^#/, '');
        hashtagsEl.appendChild(span);
      });
    }

    if (aiStatusEl) {
      aiStatusEl.textContent =
        'Sammanfattning av videon/podden dyker upp här när AI är klar.';
    }
  }

  async function generateTimestamps() {
    if (!urlInput) return;

    const url = urlInput.value.trim();
    if (!url) {
      alert('Klistra in en video- eller podd-URL först.');
      return;
    }

    // Visa "AI jobbar..." och lås knappen
    if (generateBtnEl && generateBtnTextEl && generateStatusEl) {
      generateBtnEl.disabled = true;
      generateBtnEl.classList.add('loading');
      generateBtnTextEl.textContent = 'AI jobbar…';
      generateStatusEl.style.display = 'block';
      generateStatusEl.textContent = 'Kenai analyserar din video…';
    }

    try {
      const res = await fetch('/api/timestamps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        throw new Error('Fel från servern: ' + res.status);
      }

      const json = await res.json();
      console.log('Timestamps JSON:', json);
      renderResult(json);
    } catch (error) {
      console.error('Fel vid timestamps-anrop:', error);
      if (generateStatusEl) {
        generateStatusEl.style.display = 'block';
        generateStatusEl.textContent = 'Något gick fel. Försök igen.';
      }
    } finally {
      if (generateBtnEl && generateBtnTextEl && generateStatusEl) {
        generateBtnEl.disabled = false;
        generateBtnEl.classList.remove('loading');
        generateBtnTextEl.textContent = 'Generera timestamps med AI';
        generateStatusEl.style.display = 'block';
        generateStatusEl.textContent = 'Klar! Timestamps genererade ✅';
      }
    }
  }

  if (generateBtnEl) {
    generateBtnEl.addEventListener('click', generateTimestamps);
  }

  if (urlInput) {
    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        generateTimestamps();
      }
    });
  }
})();
