export function createNavigation(doc, cartons) {
  const element = id => doc.getElementById(id);
  const screens = { home: element('beamHome'), search: element('beamSearch'), inspection: element('sheetWorkspace') };
  let view = 'home';

  function show(next, cartonMode) {
    if (next !== 'carton') cartons.hide();
    view = next;
    for (const [name, screen] of Object.entries(screens)) {
      screen.hidden = screen.inert = name !== next;
    }
    element('beamBack').hidden = next !== 'inspection';
    element('beamHomeBack').hidden = next === 'home';
    doc.body.dataset.beamView = next;
    if (next === 'carton') cartons.open(cartonMode);
  }

  return { show, isInspection: () => view === 'inspection' };
}
