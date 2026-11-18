// Camera scan screens (PRD 5; contracts 4 and 10).
//   /scan          viewfinder with Identify, Photos, Snap Tips, close, flash and flip; photo upload when the
//                  camera is denied or missing (CS-1, CS-9)
//   /scan/confirm  "We think this is: ___. Is that right?" with Yes and Edit; or which-one for several
//                  items; or retake-or-type when the photo is unclear (CS-5, CS-7, CS-8, K2)
// This feature never asks the engine itself. Only a confirmed or typed label is handed to the item page,
// and identification never carries a stream, verdict or disposal advice (CS-4).
import { identify } from '../../shared/api.js';
import { clear, h } from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';
import { limitBlock } from '../../shared/limit-message.js';
import { ACCEPTED_TYPES, fileToDataUrl, frameToDataUrl } from './capture.js';

// The identification waiting to be confirmed. Labels only: the photo itself is never kept.
let pending = null;

const itemHref = (label) => `/item?q=${encodeURIComponent(label.trim().slice(0, 2000))}&origin=scan`;

function typeItemForm(ctx, { initial = '', label = 'Type the item', button = 'Look it up' } = {}) {
  const input = h('input', { class: 'field', id: 'scan-typed', type: 'text', maxlength: 200, autocomplete: 'off', value: initial });
  return h(
    'form',
    {
      class: 'stack',
      onsubmit: (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        pending = null;
        ctx.navigate(itemHref(text));
      },
    },
    h('label', { class: 'field-label', for: 'scan-typed' }, label),
    input,
    h('button', { type: 'submit', class: 'button button-secondary' }, button),
  );
}

function mountScan(container, ctx) {
  ctx.setTitle('Camera scan');
  let alive = true;
  let stream = null;
  let facing = 'environment';
  let torchOn = false;
  let busy = false;

  const video = h('video', { class: 'scan-video', autoplay: true, playsinline: true, muted: true, 'aria-label': 'Camera viewfinder' });
  video.muted = true;
  const status = h('p', { class: 'status-line', role: 'status' });
  const fileInput = h('input', { type: 'file', id: 'scan-file', class: 'visually-hidden', tabindex: '-1', accept: ACCEPTED_TYPES.join(',') });
  const tips = h(
    'div',
    { class: 'notice stack', id: 'snap-tips', hidden: true },
    h('h2', { class: 'section-title' }, 'Snap Tips'),
    h(
      'ul',
      { class: 'bullets' },
      h('li', {}, 'Photograph one item at a time.'),
      h('li', {}, 'Fill the frame with the whole item.'),
      h('li', {}, 'Use good light and hold steady.'),
      h('li', {}, 'RefCycle names the item only. A photo cannot show everything, so you may be asked a question.'),
    ),
  );
  const result = h('div', { class: 'stack' });

  const closeButton = h('a', { class: 'scan-round', href: '/home', 'aria-label': 'Close' }, icon('x-mark'));
  const flashButton = h('button', { type: 'button', class: 'scan-round', 'aria-label': 'Flash', 'aria-pressed': 'false', disabled: true }, icon('bolt'));
  const flipButton = h('button', { type: 'button', class: 'scan-round', 'aria-label': 'Flip camera', disabled: true }, icon('arrow-path'));
  const identifyButton = h('button', { type: 'button', class: 'button scan-identify', disabled: true }, icon('camera'), 'Identify');
  const photosButton = h('label', { class: 'button button-secondary', for: 'scan-file', role: 'button', tabindex: '0' }, icon('photo'), 'Photos');
  const tipsButton = h('button', { type: 'button', class: 'button button-secondary', 'aria-expanded': 'false', 'aria-controls': 'snap-tips' }, 'Snap Tips');
  const fallback = h(
    'div',
    { class: 'notice stack', hidden: true },
    h('p', {}, 'The camera is not available here. Choose a photo instead.'),
  );
  const viewfinder = h('div', { class: 'scan-viewfinder' }, video, h('div', { class: 'scan-top' }, closeButton, h('div', { class: 'row' }, flashButton, flipButton)));

  function stopCamera() {
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    video.srcObject = null;
  }

  function showUploadOnly() {
    stopCamera();
    viewfinder.hidden = true;
    identifyButton.hidden = true;
    fallback.hidden = false;
  }

  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return showUploadOnly();
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
      if (!alive) {
        for (const track of media.getTracks()) track.stop();
        return;
      }
      stream = media;
      video.srcObject = media;
      // Not awaited: some cameras resolve play() late, and the controls should not wait on it.
      video.play().catch(() => {});
      identifyButton.disabled = false;
      flipButton.disabled = false;
      const track = media.getVideoTracks()[0];
      const canTorch = !!track && typeof track.getCapabilities === 'function' && !!track.getCapabilities().torch;
      flashButton.disabled = !canTorch;
      torchOn = false;
      flashButton.setAttribute('aria-pressed', 'false');
    } catch {
      // Permission denied, no camera, or the camera is busy: offer photo upload instead (CS-9).
      if (alive) showUploadOnly();
    }
  }

  async function send(makeDataUrl) {
    if (busy) return;
    busy = true;
    identifyButton.disabled = true;
    status.textContent = '';
    clear(result).appendChild(
      h('div', { class: 'loading-block', 'aria-busy': 'true' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Identifying' }), h('p', { class: 'subhead' }, 'Looking at the photo.')),
    );
    let outcome;
    try {
      outcome = await identify(await makeDataUrl());
    } catch (error) {
      outcome = { kind: 'error', message: error instanceof Error ? error.message : '' };
    }
    if (!alive) return;
    busy = false;
    clear(result);
    if (stream) identifyButton.disabled = false;
    if (outcome.kind === 'limit') {
      result.appendChild(limitBlock(outcome.message));
      return;
    }
    if (outcome.kind !== 'result' || !outcome.result || typeof outcome.result.status !== 'string') {
      // No guess is made: the resident retakes the photo or names the item (CS-5).
      result.appendChild(
        h(
          'div',
          { class: 'notice stack' },
          h('p', {}, outcome.message || 'The photo could not be identified. Retake it, choose another photo, or type the item.'),
          typeItemForm(ctx),
        ),
      );
      return;
    }
    const r = outcome.result;
    pending = {
      status: r.status,
      label: typeof r.label === 'string' ? r.label : null,
      candidates: Array.isArray(r.candidates) ? r.candidates.filter((c) => typeof c === 'string' && c.trim()).slice(0, 4) : [],
    };
    ctx.navigate('/scan/confirm');
  }

  identifyButton.addEventListener('click', () => send(async () => frameToDataUrl(video)));
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    send(() => fileToDataUrl(file)).finally(() => {
      fileInput.value = '';
    });
  });
  photosButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  flipButton.addEventListener('click', () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    startCamera();
  });
  flashButton.addEventListener('click', async () => {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      torchOn = !torchOn;
      flashButton.setAttribute('aria-pressed', String(torchOn));
    } catch {
      status.textContent = 'The flash is not available on this camera.';
    }
  });
  tipsButton.addEventListener('click', () => {
    tips.hidden = !tips.hidden;
    tipsButton.setAttribute('aria-expanded', String(!tips.hidden));
  });

  container.appendChild(
    h('div', { class: 'stack-wide' }, viewfinder, fallback, h('div', { class: 'scan-actions' }, identifyButton, photosButton, tipsButton), fileInput, status, tips, result),
  );
  startCamera();

  return () => {
    alive = false;
    stopCamera();
  };
}

function mountConfirm(container, ctx) {
  ctx.setTitle('Camera scan');
  if (!pending) {
    ctx.navigate('/scan', { replace: true });
    return null;
  }
  const { status, label, candidates } = pending;
  const retake = h('a', { class: 'button button-secondary', href: '/scan' }, icon('camera'), 'Retake photo');
  const box = h('div', { class: 'stack-wide' });

  if (status === 'identified' && label) {
    const edit = h('div', { hidden: true }, typeItemForm(ctx, { initial: label, label: 'Correct the item', button: 'Use this' }));
    box.appendChild(h('h1', { class: 'h2' }, `We think this is: ${label}. Is that right?`));
    box.appendChild(
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            type: 'button',
            class: 'button',
            onclick: () => {
              pending = null;
              ctx.navigate(itemHref(label));
            },
          },
          'Yes',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'button button-secondary',
            onclick: () => {
              edit.hidden = false;
              edit.querySelector('input')?.focus();
            },
          },
          'Edit',
        ),
        retake,
      ),
    );
    box.appendChild(edit);
  } else if (status === 'multiple') {
    box.appendChild(h('h1', { class: 'h2' }, 'This photo shows more than one item. Which one do you mean?'));
    if (candidates.length) {
      box.appendChild(
        h(
          'ul',
          { class: 'link-list' },
          candidates.map((name) =>
            h(
              'li',
              {},
              h(
                'button',
                {
                  type: 'button',
                  class: 'list-item button-block',
                  onclick: () => {
                    pending = null;
                    ctx.navigate(itemHref(name));
                  },
                },
                name,
              ),
            ),
          ),
        ),
      );
    }
    box.appendChild(typeItemForm(ctx, { label: 'Or type the item' }));
    box.appendChild(h('div', { class: 'row' }, retake));
  } else {
    box.appendChild(h('h1', { class: 'h2' }, 'We could not tell what this is.'));
    box.appendChild(h('p', {}, 'Retake the photo, or type the item.'));
    box.appendChild(h('div', { class: 'row' }, retake));
    box.appendChild(typeItemForm(ctx));
  }
  container.appendChild(box);
  return null;
}

export function mount(route, container, ctx) {
  return route.path === '/scan/confirm' ? mountConfirm(container, ctx) : mountScan(container, ctx);
}
