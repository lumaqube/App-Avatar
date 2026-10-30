// Turns a change in QBooth status into what the avatar says and does.
// Fixed script only (stage 1): no LLM here. Returns a list of reactions:
//   { key, vars, gesture, mood, interrupt }
// key = a LINES key, gesture = wave | nod | present, mood = an expression to flash.
export function react(prev, cur) {
  const out = [];
  const add = (key, extra = {}) => out.push({ key, vars: {}, ...extra });

  if (!cur) return out; // offline: the status dot shows it, the avatar stays quiet
  if (!cur.event) {
    if (!prev || prev.event) add('noEvent');
    return out;
  }

  const page = cur.page, prevPage = prev?.event ? prev.page : null;
  const cam = cur.camera, prevCam = prev?.camera;

  if (page !== prevPage) {
    switch (page) {
      case 'welcome':
        if (prev?.session?.active && prevPage && prevPage !== 'welcome') add('bye', { gesture: 'wave', interrupt: true });
        else add('greet', { gesture: 'wave' });
        break;
      case 'survey': case 'categoryPicker': case 'templatePicker': case 'input':
        add(page, { gesture: 'present', interrupt: true });
        break;
      case 'camera':
        if (cur.session?.templateName) add('templateChosen', { vars: { name: cur.session.templateName }, gesture: 'nod', interrupt: true });
        add('cameraReady', { gesture: 'present' });
        break;
      case 'result':
        add('result', { gesture: 'nod', mood: 'happy', interrupt: true });
        break;
    }
  } else if (page === 'camera' && cam && cam.phase !== prevCam?.phase) {
    if (cam.phase === 'counting') {
      if (prevCam?.phase === 'review') add('retake', { interrupt: true });
      else if (cam.shot <= 1) add('countFirst', { mood: 'happy', interrupt: true });
      else add('countNext', { vars: { n: cam.shot, total: cam.shots }, interrupt: true });
    } else if (cam.phase === 'review') {
      add(cam.retakesLeft > 0 ? 'review' : 'reviewNoRetake', { gesture: 'nod', interrupt: true });
    }
  }

  if (cur.busy?.processing && !prev?.busy?.processing) add('processing', { interrupt: true });
  if (cur.busy?.dialog && !prev?.busy?.dialog && page === 'welcome') add('dialog', { gesture: 'present' });

  return out;
}
