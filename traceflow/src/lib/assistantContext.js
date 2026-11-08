// Explicit UI actions stay local until the person asks for an explanation.
export function openAssistant(context = {}, intent = 'explain') {
  window.dispatchEvent(new CustomEvent('traceflow:assistant', { detail: { context, intent } }));
}
