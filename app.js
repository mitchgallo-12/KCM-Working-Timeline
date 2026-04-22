/* ==========================================================================
   KCM Project Tracker — app.js
   Single-file vanilla JS app. Loads data.json, renders views, tracks edits
   in browser, exports updated data.json for git commit.
   ========================================================================== */

(function () {
  'use strict';

  // ----- State -----
  const state = {
    data: null,
    view: 'dashboard',
    activeProjectId: null,
    filters: {
      projectFilter: 'all',
      statusFilter: 'all',
      search: ''
    },
    dirty: false
  };

  // ----- Constants -----
  const STATUS_CLASS = {
    'Complete': 'status-complete',
    'In Progress': 'status-progress',
    'Waiting on Info': 'status-waiting',
    'At Risk': 'status-risk',
    'Blocked': 'status-blocked',
    'Not Started': 'status-notstarted'
  };

  const PRIORITY_CLASS = {
    'P1 - Critical': 'priority-p1',
    'P2 - High': 'priority-p2',
    'P3 - Standard': 'priority-p3',
    'P4 - Watch': 'priority-p4'
  };

  // ----- Utilities -----
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'onClick') e.addEventListener('click', attrs[k]);
        else if (k === 'onInput') e.addEventListener('input', attrs[k]);
        else if (k === 'onChange') e.addEventListener('change', attrs[k]);
        else if (k === 'onBlur') e.addEventListener('blur', attrs[k]);
        else if (k === 'dataset') Object.assign(e.dataset, attrs[k]);
        else if (k === 'html') e.innerHTML = attrs[k];
        else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
      }
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children];
      arr.forEach(c => {
        if (c == null || c === false) return;
        if (typeof c === 'string' || typeof c === 'number') e.appendChild(document.createTextNode(c));
        else e.appendChild(c);
      });
    }
    return e;
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d + 'T00:00:00');
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtMoney(n) {
    if (n == null || n === '') return '—';
    const num = typeof n === 'number' ? n : parseFloat(n);
    if (isNaN(num)) return n;
    return '$' + num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    const aa = new Date(a + 'T00:00:00');
    const bb = new Date(b + 'T00:00:00');
    return Math.round((bb - aa) / (1000 * 60 * 60 * 24));
  }

  function markDirty() {
    state.dirty = true;
    $('#meta-updated').textContent = 'Unsaved changes';
  }

  function toast(msg) {
    const root = $('#toast-root');
    root.innerHTML = '';
    const t = el('div', { class: 'toast' }, msg);
    root.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ----- Data load -----
  async function loadData() {
    // Try localStorage working copy first so edits persist between page loads
    const cached = localStorage.getItem('kcm_tracker_working');
    if (cached) {
      try {
        state.data = JSON.parse(cached);
        state.dirty = true; // working copy is, by definition, ahead of data.json
        return;
      } catch (e) {
        console.warn('Bad localStorage cache, falling through to data.json', e);
      }
    }

    try {
      const res = await fetch('data.json?cb=' + Date.now());
      if (!res.ok) throw new Error('data.json HTTP ' + res.status);
      state.data = await res.json();
    } catch (e) {
      console.error(e);
      $('#main').innerHTML = '<div class="card"><h2>Could not load data.json</h2><p class="hint">Serve this folder over HTTP (e.g., <code>python -m http.server</code>) instead of opening the file directly. Browsers block <code>fetch</code> of local files over the <code>file://</code> protocol.</p></div>';
      throw e;
    }
  }

  function saveWorkingCopy() {
    try {
      localStorage.setItem('kcm_tracker_working', JSON.stringify(state.data));
    } catch (e) {
      console.warn('localStorage save failed', e);
    }
  }

  function clearWorkingCopy() {
    localStorage.removeItem('kcm_tracker_working');
  }

  // ----- Add / Remove tasks & milestones -----
  // Derive the id prefix used by existing items in this collection, falling
  // back to the project id (e.g., "bwm", "drip"). Initiatives already carry
  // their own id like "kcm-i1" or "es-i3", so we use that directly.
  function idPrefix(project, initiative, kind) {
    if (initiative) return initiative.id;
    const items = (kind === 't' ? project.tasks : project.milestones) || [];
    for (const it of items) {
      const m = (it.id || '').match(/^(.*)-[mt]\d+$/);
      if (m) return m[1];
    }
    return String(project.id).replace(/_/g, '-');
  }

  function nextId(project, kind, initiative) {
    const prefix = idPrefix(project, initiative, kind);
    // Scan every id in this project (top-level AND across initiatives) that
    // matches `<prefix>-<kind><n>` so we never collide even if items were
    // previously deleted mid-sequence.
    let max = 0;
    const scan = (arr) => {
      for (const it of (arr || [])) {
        const m = (it.id || '').match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-' + kind + '(\\d+)$'));
        if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
      }
    };
    if (initiative) {
      scan(kind === 't' ? initiative.tasks : initiative.milestones);
    } else {
      scan(kind === 't' ? project.tasks : project.milestones);
    }
    return `${prefix}-${kind}${max + 1}`;
  }

  function addMilestone(project, initiative) {
    const m = {
      id: nextId(project, 'm', initiative),
      name: 'New milestone',
      target_date: null,
      status: 'Not Started',
      owner: null,
      notes: null
    };
    const arr = initiative ? (initiative.milestones = initiative.milestones || []) : (project.milestones = project.milestones || []);
    arr.push(m);
    markDirty(); saveWorkingCopy(); renderAll();
    toast('Milestone added');
  }

  function deleteMilestone(project, initiative, id) {
    if (!confirm('Delete this milestone? This cannot be undone until you reload from data.json.')) return;
    const arr = initiative ? (initiative.milestones || []) : (project.milestones || []);
    const idx = arr.findIndex(x => x.id === id);
    if (idx < 0) return;
    arr.splice(idx, 1);
    markDirty(); saveWorkingCopy(); renderAll();
    toast('Milestone deleted');
  }

  function addTask(project, initiative, workstreamHint) {
    const t = {
      id: nextId(project, 't', initiative),
      workstream: workstreamHint || null,
      name: 'New task',
      owner: null,
      status: 'Not Started',
      priority: 'P3 - Standard',
      start: null,
      end: null,
      percent_complete: null,
      budget: null,
      actual: null,
      info_needed_from: null,
      due_date: null,
      counterparty: null,
      next_action: null,
      last_update: null,
      notes: null
    };
    const arr = initiative ? (initiative.tasks = initiative.tasks || []) : (project.tasks = project.tasks || []);
    arr.push(t);
    markDirty(); saveWorkingCopy(); renderAll();
    toast('Task added');
  }

  function deleteTask(project, initiative, id) {
    if (!confirm('Delete this task? This cannot be undone until you reload from data.json.')) return;
    const arr = initiative ? (initiative.tasks || []) : (project.tasks || []);
    const idx = arr.findIndex(x => x.id === id);
    if (idx < 0) return;
    arr.splice(idx, 1);
    markDirty(); saveWorkingCopy(); renderAll();
    toast('Task deleted');
  }

  function exportJSON() {
    state.data.meta.updated = todayISO();
    const json = JSON.stringify(state.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    clearWorkingCopy();
    state.dirty = false;
    $('#meta-updated').textContent = 'Updated ' + state.data.meta.updated;
    toast('Exported data.json — commit it to git to save');
  }

  // ----- Domain helpers -----
  function allTasks() {
    const tasks = [];
    for (const p of state.data.projects) {
      if (p.tasks) {
        for (const t of p.tasks) tasks.push({ project: p, task: t });
      }
      if (p.initiatives) {
        for (const i of p.initiatives) {
          for (const t of (i.tasks || [])) tasks.push({ project: p, initiative: i, task: t });
        }
      }
    }
    return tasks;
  }

  function allMilestones() {
    const ms = [];
    for (const p of state.data.projects) {
      if (p.milestones) {
        for (const m of p.milestones) ms.push({ project: p, milestone: m });
      }
      if (p.initiatives) {
        for (const i of p.initiatives) {
          for (const m of (i.milestones || [])) ms.push({ project: p, initiative: i, milestone: m });
        }
      }
    }
    return ms;
  }

  function projectProgress(p) {
    const ms = p.milestones || [];
    const init = p.initiatives || [];
    let done = 0, total = 0;
    for (const m of ms) { total++; if (m.status === 'Complete') done++; }
    for (const i of init) {
      for (const m of (i.milestones || [])) { total++; if (m.status === 'Complete') done++; }
    }
    return total === 0 ? 0 : Math.round((done / total) * 100);
  }

  function projectTaskCount(p) {
    let n = (p.tasks || []).length;
    for (const i of (p.initiatives || [])) n += (i.tasks || []).length;
    return n;
  }

  function projectOpenTaskCount(p) {
    let n = 0;
    for (const t of (p.tasks || [])) if (t.status !== 'Complete') n++;
    for (const i of (p.initiatives || [])) {
      for (const t of (i.tasks || [])) if (t.status !== 'Complete') n++;
    }
    return n;
  }

  function projectById(id) {
    return state.data.projects.find(p => p.id === id);
  }

  // ----- Renderers -----
  function renderSidebar() {
    $('#meta-firm').textContent = state.data.meta.firm;
    $('#meta-updated').textContent = state.dirty ? 'Unsaved changes' : 'Updated ' + state.data.meta.updated;

    $$('.nav-link').forEach(n => {
      n.classList.toggle('active', n.dataset.view === state.view && !state.activeProjectId);
      n.addEventListener('click', () => {
        state.view = n.dataset.view;
        state.activeProjectId = null;
        renderAll();
      }, { once: false });
    });

    const pnav = $('#projects-nav');
    pnav.innerHTML = '<div class="label">Projects</div>';
    for (const p of state.data.projects) {
      const link = el('div', {
        class: 'nav-link' + (state.activeProjectId === p.id ? ' active' : ''),
        onClick: () => {
          state.view = 'project';
          state.activeProjectId = p.id;
          renderAll();
        }
      }, [el('span', { class: 'dot' }), p.short_name || p.name]);
      pnav.appendChild(link);
    }
  }

  function renderMain() {
    const main = $('#main');
    main.innerHTML = '';
    if (state.view === 'project' && state.activeProjectId) {
      main.appendChild(renderProjectDetail(projectById(state.activeProjectId)));
    } else if (state.view === 'projects') {
      main.appendChild(renderProjectsGrid());
    } else if (state.view === 'ledger') {
      main.appendChild(renderLedger());
    } else if (state.view === 'plan') {
      main.appendChild(renderMonthlyPlan());
    } else {
      main.appendChild(renderDashboard());
    }
  }

  function renderAll() {
    renderSidebar();
    renderMain();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // ----- Dashboard -----
  function renderDashboard() {
    const tasks = allTasks();
    const openTasks = tasks.filter(x => x.task.status !== 'Complete');
    const atRiskOrWaiting = tasks.filter(x =>
      x.task.status === 'At Risk' || x.task.status === 'Waiting on Info' || x.task.status === 'Blocked'
    );
    const milestones = allMilestones();
    const msComplete = milestones.filter(x => x.milestone.status === 'Complete').length;
    const msTotal = milestones.length;
    const msPct = msTotal ? Math.round((msComplete / msTotal) * 100) : 0;

    const wrap = el('div');

    // Topbar
    wrap.appendChild(el('div', { class: 'topbar' }, [
      el('div', { class: 'title-block' }, [
        el('div', { class: 'eyebrow' }, 'Firmwide'),
        el('h1', {}, 'Dashboard')
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn', onClick: () => { state.view = 'ledger'; renderAll(); } }, 'Log expense'),
        el('button', { class: 'btn primary', onClick: exportJSON }, 'Export data.json')
      ])
    ]));

    // KPIs
    const kpis = el('div', { class: 'kpi-grid' }, [
      kpi('Projects', state.data.projects.length, 'tracked'),
      kpi('Open tasks', openTasks.length, openTasks.length + ' of ' + tasks.length),
      kpi('Milestones complete', msPct + '%', msComplete + ' of ' + msTotal),
      kpi('At risk / waiting', atRiskOrWaiting.length, 'needs attention')
    ]);
    wrap.appendChild(kpis);

    // Project status card
    const projCard = el('div', { class: 'card' });
    projCard.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px' }, [
      el('h2', {}, 'Projects at a glance'),
      el('button', { class: 'btn sm ghost', onClick: () => { state.view = 'projects'; renderAll(); } }, 'View all →')
    ]));

    const tableWrap = el('div', { class: 'table-wrap' });
    const tbl = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, [
        th('Project'), th('Vertical'), th('Stage'), th('Progress'), th('Open tasks'), th('Next action')
      ])),
      el('tbody', {},
        state.data.projects.map(p => {
          const pct = projectProgress(p);
          return el('tr', { style: 'cursor:pointer', onClick: () => { state.view = 'project'; state.activeProjectId = p.id; renderAll(); } }, [
            el('td', {}, el('strong', {}, p.name)),
            el('td', {}, el('span', { class: 'tag' }, p.vertical || '—')),
            el('td', {}, p.stage || '—'),
            el('td', {}, progressBar(pct)),
            el('td', { class: 'num' }, String(projectOpenTaskCount(p))),
            el('td', {}, p.next_action || el('span', { style: 'color:var(--grey-soft);font-style:italic' }, 'pending'))
          ]);
        })
      )
    ]);
    tableWrap.appendChild(tbl);
    projCard.appendChild(tableWrap);
    wrap.appendChild(projCard);

    // At-risk / waiting card
    if (atRiskOrWaiting.length) {
      const riskCard = el('div', { class: 'card' });
      riskCard.appendChild(el('h2', { style: 'margin-bottom:10px' }, 'Needs attention'));
      const rtbl = el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, [
          th('Project'), th('Task'), th('Status'), th('Owner'), th('Info needed from')
        ])),
        el('tbody', {}, atRiskOrWaiting.map(x =>
          el('tr', { style: 'cursor:pointer', onClick: () => { state.view = 'project'; state.activeProjectId = x.project.id; renderAll(); } }, [
            el('td', {}, x.project.short_name || x.project.name),
            el('td', {}, x.task.name),
            el('td', {}, statusPill(x.task.status)),
            el('td', {}, x.task.owner || '—'),
            el('td', {}, x.task.info_needed_from || '—')
          ])
        ))
      ]);
      const rwrap = el('div', { class: 'table-wrap' }); rwrap.appendChild(rtbl);
      riskCard.appendChild(rwrap);
      wrap.appendChild(riskCard);
    }

    return wrap;
  }

  function kpi(label, value, sub) {
    return el('div', { class: 'kpi' }, [
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, String(value)),
      sub ? el('div', { class: 'sub' }, sub) : null
    ]);
  }
  function th(text) { return el('th', {}, text); }

  function statusPill(s) {
    if (!s) return el('span', { class: 'pill status-notstarted' }, 'Not Started');
    return el('span', { class: 'pill ' + (STATUS_CLASS[s] || 'status-notstarted') }, s);
  }

  function priorityPill(p) {
    if (!p) return el('span', { class: 'pill priority-p3' }, 'P3');
    const short = p.split(' ')[0];
    return el('span', { class: 'pill ' + (PRIORITY_CLASS[p] || 'priority-p3') }, short);
  }

  function progressBar(pct) {
    return el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
      el('div', { style: 'flex:1;height:6px;background:var(--porcelain-warm);border-radius:3px;overflow:hidden;max-width:120px' },
        el('span', { style: 'display:block;height:100%;background:var(--olive);width:' + pct + '%' })),
      el('span', { style: 'font-size:0.78rem;font-weight:700' }, pct + '%')
    ]);
  }

  // ----- Projects grid -----
  function renderProjectsGrid() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'topbar' }, [
      el('div', { class: 'title-block' }, [
        el('div', { class: 'eyebrow' }, 'Portfolio'),
        el('h1', {}, 'Projects')
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', onClick: exportJSON }, 'Export data.json')
      ])
    ]));

    const grid = el('div', { class: 'proj-grid' });
    for (const p of state.data.projects) {
      const pct = projectProgress(p);
      const card = el('div', {
        class: 'proj-card',
        onClick: () => { state.view = 'project'; state.activeProjectId = p.id; renderAll(); }
      }, [
        el('div', { class: 'vertical' }, p.vertical || ''),
        el('div', { class: 'name' }, p.name),
        el('div', { class: 'stage' }, p.stage || ''),
        el('div', { class: 'progress' }, [
          el('div', { class: 'bar' }, el('span', { style: 'width:' + pct + '%' })),
          el('span', { class: 'progress-num' }, pct + '%')
        ]),
        el('div', { class: 'stats' }, [
          el('span', {}, [el('span', { class: 'n' }, String((p.milestones || []).length + (p.initiatives || []).reduce((a, i) => a + (i.milestones || []).length, 0))), ' milestones']),
          el('span', {}, [el('span', { class: 'n' }, String(projectTaskCount(p))), ' tasks']),
          el('span', {}, [el('span', { class: 'n' }, String(projectOpenTaskCount(p))), ' open'])
        ])
      ]);
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  // ----- Project detail -----
  function renderProjectDetail(p) {
    const wrap = el('div');

    // Header
    wrap.appendChild(el('div', { class: 'topbar' }, [
      el('div', { class: 'title-block' }, [
        el('div', { class: 'eyebrow' }, p.vertical || ''),
        el('h1', {}, p.name),
        el('div', { class: 'hint', style: 'margin-top:4px' }, p.stage || '')
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn', onClick: () => openProjectMetaModal(p) }, 'Edit details'),
        el('button', { class: 'btn primary', onClick: exportJSON }, 'Export data.json')
      ])
    ]));

    // Meta strip
    const pct = projectProgress(p);
    wrap.appendChild(el('div', { class: 'card', style: 'margin-bottom:18px' }, [
      el('div', { class: 'detail-header' }, [
        el('div', {}, [
          el('div', { class: 'hint' }, 'Lead owner'),
          el('div', {}, el('strong', {}, p.lead_owner || '—'))
        ]),
        el('div', {}, [
          el('div', { class: 'hint' }, 'Counterparty'),
          el('div', {}, el('strong', {}, p.counterparty || '—'))
        ]),
        el('div', {}, [
          el('div', { class: 'hint' }, 'Budget'),
          el('div', {}, el('strong', {}, fmtMoney(p.total_budget)))
        ]),
        el('div', {}, [
          el('div', { class: 'hint' }, 'Deployed'),
          el('div', {}, el('strong', {}, fmtMoney(p.deployed_to_date)))
        ]),
        el('div', { style: 'flex:1;min-width:220px' }, [
          el('div', { class: 'hint' }, 'Progress'),
          progressBar(pct)
        ])
      ]),
      p.next_action ? el('div', { style: 'margin-top:12px;padding-top:12px;border-top:1px solid var(--grey-line)' }, [
        el('span', { class: 'hint' }, 'NEXT ACTION  '),
        el('span', {}, p.next_action)
      ]) : null
    ]));

    // Gantt
    const ganttData = buildGanttRows(p);
    if (ganttData.length) {
      wrap.appendChild(el('h2', { style: 'margin:8px 0 10px' }, 'Timeline'));
      wrap.appendChild(renderGantt(ganttData));
    }

    // Milestones
    if (p.milestones && p.milestones.length) {
      wrap.appendChild(el('h2', { style: 'margin:22px 0 10px' }, 'Milestones'));
      wrap.appendChild(renderMilestoneTable(p, p.milestones, null));
    }

    // Initiatives (KCM Internal)
    if (p.initiatives && p.initiatives.length) {
      for (const i of p.initiatives) {
        wrap.appendChild(el('h2', { style: 'margin:26px 0 4px' }, i.name));
        wrap.appendChild(el('div', { class: 'hint', style: 'margin-bottom:10px' }, `Initiative of KCM Internal`));
        wrap.appendChild(renderMilestoneTable(p, i.milestones || [], i));
        if ((i.tasks || []).length) {
          wrap.appendChild(el('div', { style: 'margin-top:10px' }));
          wrap.appendChild(renderTaskTable(p, i.tasks, i));
        }
      }
    }

    // Tasks grouped by workstream
    if (p.tasks && p.tasks.length) {
      wrap.appendChild(el('h2', { style: 'margin:26px 0 10px' }, 'Tasks'));
      const workstreams = {};
      for (const t of p.tasks) {
        const ws = t.workstream || 'General';
        if (!workstreams[ws]) workstreams[ws] = [];
        workstreams[ws].push(t);
      }
      for (const ws of state.data.taxonomies.workstreams) {
        if (!workstreams[ws]) continue;
        const group = el('div', { class: 'workstream-group' }, [
          el('div', { class: 'ws-title' }, ws),
          renderTaskTable(p, workstreams[ws], null, ws)
        ]);
        wrap.appendChild(group);
      }
      // any workstreams not in taxonomy
      for (const ws of Object.keys(workstreams)) {
        if (state.data.taxonomies.workstreams.includes(ws)) continue;
        wrap.appendChild(el('div', { class: 'workstream-group' }, [
          el('div', { class: 'ws-title' }, ws),
          renderTaskTable(p, workstreams[ws], null, ws)
        ]));
      }
    }

    // If the project has no workstream-grouped tasks yet, offer an "+ Add task"
    // entry point per workstream so the user can bootstrap the list.
    if (!p.initiatives && (!p.tasks || !p.tasks.length)) {
      wrap.appendChild(el('h2', { style: 'margin:26px 0 10px' }, 'Tasks'));
      wrap.appendChild(el('div', { class: 'hint', style: 'margin-bottom:10px' }, 'No tasks yet. Start one under any workstream:'));
      const bar = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' });
      for (const ws of state.data.taxonomies.workstreams) {
        bar.appendChild(el('button', {
          class: 'btn sm ghost',
          onClick: () => addTask(p, null, ws)
        }, `+ ${ws}`));
      }
      wrap.appendChild(bar);
    }

    return wrap;
  }

  function renderMilestoneTable(project, milestones, initiative) {
    const wrap = el('div', { class: 'table-wrap' });
    const tbl = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, [
        th('Milestone'), th('Target date'), th('Status'), th('Owner'), th('Notes'), th('')
      ])),
      el('tbody', {}, milestones.map(m => el('tr', {}, [
        el('td', {}, el('strong', {}, editText(m, 'name', project))),
        el('td', {}, editDate(m, 'target_date', project)),
        el('td', {}, editSelect(m, 'status', state.data.taxonomies.statuses, project, () => renderAll())),
        el('td', {}, editSelect(m, 'owner', state.data.taxonomies.owners, project)),
        el('td', {}, editText(m, 'notes', project, 'Add note...')),
        el('td', { style: 'width:1%;white-space:nowrap' },
          el('button', {
            class: 'btn sm danger ghost',
            title: 'Delete milestone',
            onClick: () => deleteMilestone(project, initiative, m.id)
          }, '×')
        )
      ])))
    ]);
    wrap.appendChild(tbl);
    wrap.appendChild(el('div', { style: 'margin-top:8px' }, [
      el('button', {
        class: 'btn sm ghost',
        onClick: () => addMilestone(project, initiative)
      }, '+ Add milestone')
    ]));
    return wrap;
  }

  function renderTaskTable(project, tasks, initiative, workstreamHint) {
    const wrap = el('div', { class: 'table-wrap' });
    const tbl = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, [
        th('Task'), th('Owner'), th('Status'), th('Priority'), th('Start'), th('End'), th('%'), th('Info needed'), th('')
      ])),
      el('tbody', {}, tasks.map(t => el('tr', {}, [
        el('td', {}, editText(t, 'name', project)),
        el('td', {}, editSelect(t, 'owner', state.data.taxonomies.owners, project)),
        el('td', {}, editSelect(t, 'status', state.data.taxonomies.statuses, project, () => renderAll())),
        el('td', {}, editSelect(t, 'priority', state.data.taxonomies.priorities, project)),
        el('td', {}, editDate(t, 'start', project)),
        el('td', {}, editDate(t, 'end', project)),
        el('td', { class: 'num' }, editNumber(t, 'percent_complete', project, '0-100')),
        el('td', {}, editText(t, 'info_needed_from', project, 'From...')),
        el('td', { style: 'width:1%;white-space:nowrap' },
          el('button', {
            class: 'btn sm danger ghost',
            title: 'Delete task',
            onClick: () => deleteTask(project, initiative, t.id)
          }, '×')
        )
      ])))
    ]);
    wrap.appendChild(tbl);
    wrap.appendChild(el('div', { style: 'margin-top:8px' }, [
      el('button', {
        class: 'btn sm ghost',
        onClick: () => addTask(project, initiative, workstreamHint)
      }, workstreamHint ? `+ Add task to ${workstreamHint}` : '+ Add task')
    ]));
    return wrap;
  }

  // ----- Gantt -----
  function buildGanttRows(p) {
    const rows = [];
    // Milestones at top as diamond markers (use target_date as both start/end)
    for (const m of (p.milestones || [])) {
      if (m.target_date) rows.push({ type: 'milestone', label: m.name, start: m.target_date, end: m.target_date, status: m.status });
    }
    for (const i of (p.initiatives || [])) {
      for (const m of (i.milestones || [])) {
        if (m.target_date) rows.push({ type: 'milestone', label: i.name + ' — ' + m.name, start: m.target_date, end: m.target_date, status: m.status });
      }
    }
    // Tasks with start + end
    for (const t of (p.tasks || [])) {
      if (t.start && t.end) rows.push({ type: 'task', label: t.name, start: t.start, end: t.end, status: t.status });
    }
    for (const i of (p.initiatives || [])) {
      for (const t of (i.tasks || [])) {
        if (t.start && t.end) rows.push({ type: 'task', label: i.name + ' — ' + t.name, start: t.start, end: t.end, status: t.status });
      }
    }
    return rows;
  }

  function renderGantt(rows) {
    const horizon = state.data.meta;
    const startDate = horizon.horizon_start;
    const endDate = horizon.horizon_end;
    const totalDays = daysBetween(startDate, endDate);
    if (totalDays <= 0) return el('div', { class: 'empty' }, 'Invalid horizon dates');

    // If no dated rows, show empty state with help
    if (!rows.length) {
      return el('div', { class: 'empty' }, 'No dated milestones or tasks yet. Set a target date on a milestone — or start/end dates on a task — to see it on the timeline.');
    }

    const gantt = el('div', { class: 'gantt' });
    // Header with month labels
    const months = [];
    const s = new Date(startDate + 'T00:00:00');
    const e = new Date(endDate + 'T00:00:00');
    const cursor = new Date(s.getFullYear(), s.getMonth(), 1);
    while (cursor <= e) {
      const isoDate = cursor.toISOString().slice(0, 10);
      const daysFromStart = daysBetween(startDate, isoDate);
      const pct = Math.max(0, (daysFromStart / totalDays) * 100);
      months.push({
        label: cursor.toLocaleDateString('en-US', { month: 'short', year: cursor.getMonth() === 0 ? '2-digit' : undefined }),
        pct
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const header = el('div', { class: 'gantt-header' }, [
      el('div', { class: 'labels-col' }, 'Item'),
      el('div', { class: 'months' }, months.map(m =>
        el('div', { class: 'month', style: 'left:' + m.pct + '%' }, m.label)
      ))
    ]);
    gantt.appendChild(header);

    // Today marker
    const today = todayISO();
    const todayPct = Math.max(0, Math.min(100, (daysBetween(startDate, today) / totalDays) * 100));

    // Rows
    for (const r of rows) {
      const startPct = Math.max(0, (daysBetween(startDate, r.start) / totalDays) * 100);
      const endPct = Math.min(100, (daysBetween(startDate, r.end) / totalDays) * 100);
      const widthPct = Math.max(0.4, endPct - startPct);

      const statusColor = {
        'Complete': 'var(--status-complete)',
        'In Progress': 'var(--olive)',
        'Waiting on Info': 'var(--status-waiting)',
        'At Risk': 'var(--status-risk)',
        'Blocked': 'var(--status-blocked)',
        'Not Started': 'var(--grey-soft)'
      }[r.status] || 'var(--olive)';

      const bar = r.type === 'milestone'
        ? el('div', {
            class: 'gantt-bar milestone',
            style: 'left:calc(' + startPct + '% - 5px);background:' + statusColor + ';',
            title: r.label + ' · ' + r.start + ' · ' + (r.status || '')
          })
        : el('div', {
            class: 'gantt-bar',
            style: 'left:' + startPct + '%;width:' + widthPct + '%;background:' + statusColor + ';',
            title: r.label + ' · ' + r.start + ' → ' + r.end + ' · ' + (r.status || '')
          }, el('div', { class: 'label-inner' }, r.label));

      const row = el('div', { class: 'gantt-row' }, [
        el('div', { class: 'label', title: r.label }, r.label),
        el('div', { class: 'track' }, bar)
      ]);
      gantt.appendChild(row);
    }

    // Today vertical line (placed in the first track column by positioning inside gantt)
    const todayMarker = el('div', {
      class: 'gantt-today',
      style: 'left:calc(220px + ' + todayPct + '% - ' + (todayPct * 220 / 100) + 'px);'
    });
    // Simpler: compute pixel position of today line inside the chart area. Use CSS calc trick.
    todayMarker.style.left = '';
    // Inject overlay using absolute positioning within .gantt
    const overlay = el('div', { style: 'position:absolute;top:32px;bottom:8px;left:220px;right:0;pointer-events:none' });
    const line = el('div', {
      class: 'gantt-today',
      style: 'position:absolute;top:0;bottom:0;left:' + todayPct + '%;'
    });
    overlay.appendChild(line);
    gantt.appendChild(overlay);

    return gantt;
  }

  // ----- Editable cells -----
  function editText(obj, field, project, placeholder) {
    const val = obj[field];
    const span = el('div', {
      class: 'edit-cell' + (val ? '' : ' placeholder'),
      contenteditable: 'true'
    }, val || (placeholder || '—'));
    span.addEventListener('focus', () => {
      if (span.classList.contains('placeholder')) {
        span.textContent = '';
        span.classList.remove('placeholder');
      }
    });
    span.addEventListener('blur', () => {
      const newVal = span.textContent.trim();
      if (newVal === '') {
        obj[field] = null;
        span.classList.add('placeholder');
        span.textContent = placeholder || '—';
      } else if (newVal !== val) {
        obj[field] = newVal;
      }
      if (obj[field] !== val) { markDirty(); saveWorkingCopy(); }
    });
    return span;
  }

  function editDate(obj, field, project) {
    const input = el('input', {
      class: 'edit',
      type: 'date',
      value: obj[field] || ''
    });
    input.addEventListener('change', () => {
      const v = input.value || null;
      if (v !== obj[field]) {
        obj[field] = v;
        markDirty();
        saveWorkingCopy();
      }
    });
    return input;
  }

  function editNumber(obj, field, project, placeholder) {
    const input = el('input', {
      class: 'edit',
      type: 'number',
      value: obj[field] != null ? obj[field] : '',
      placeholder: placeholder || ''
    });
    input.style.maxWidth = '70px';
    input.addEventListener('change', () => {
      const v = input.value === '' ? null : parseFloat(input.value);
      if (v !== obj[field]) {
        obj[field] = v;
        markDirty();
        saveWorkingCopy();
      }
    });
    return input;
  }

  function editSelect(obj, field, options, project, onAfterChange) {
    const sel = el('select', { class: 'edit' });
    sel.appendChild(el('option', { value: '' }, '—'));
    for (const opt of options) {
      const o = el('option', { value: opt }, opt);
      if (obj[field] === opt) o.setAttribute('selected', 'selected');
      sel.appendChild(o);
    }
    sel.value = obj[field] || '';
    sel.addEventListener('change', () => {
      const v = sel.value || null;
      if (v !== obj[field]) {
        obj[field] = v;
        markDirty();
        saveWorkingCopy();
        if (onAfterChange) onAfterChange();
      }
    });
    return sel;
  }

  // ----- Project meta modal -----
  function openProjectMetaModal(p) {
    const root = $('#modal-root');
    root.innerHTML = '';
    const stageInput = el('input', { value: p.stage || '' });
    const leadInput = el('select', {}, state.data.taxonomies.owners.map(o =>
      el('option', Object.assign({ value: o }, p.lead_owner === o ? { selected: 'selected' } : {}), o)
    ));
    leadInput.value = p.lead_owner || '';
    const cpInput = el('input', { value: p.counterparty || '' });
    const budgetInput = el('input', { type: 'number', value: p.total_budget != null ? p.total_budget : '' });
    const deployedInput = el('input', { type: 'number', value: p.deployed_to_date != null ? p.deployed_to_date : '' });
    const nextInput = el('textarea', {}, p.next_action || '');

    const modal = el('div', { class: 'modal' }, [
      el('h3', {}, 'Edit ' + p.name),
      row('Stage', stageInput),
      row('Lead owner', leadInput),
      row('Counterparty', cpInput),
      row('Total budget ($)', budgetInput),
      row('Deployed to date ($)', deployedInput),
      row('Next action', nextInput),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn', onClick: () => root.innerHTML = '' }, 'Cancel'),
        el('button', { class: 'btn primary', onClick: () => {
          p.stage = stageInput.value.trim() || null;
          p.lead_owner = leadInput.value || null;
          p.counterparty = cpInput.value.trim() || null;
          p.total_budget = budgetInput.value === '' ? null : parseFloat(budgetInput.value);
          p.deployed_to_date = deployedInput.value === '' ? null : parseFloat(deployedInput.value);
          p.next_action = nextInput.value.trim() || null;
          markDirty(); saveWorkingCopy();
          root.innerHTML = '';
          renderAll();
        } }, 'Save')
      ])
    ]);
    const backdrop = el('div', { class: 'modal-backdrop', onClick: (e) => {
      if (e.target === backdrop) root.innerHTML = '';
    } }, modal);
    root.appendChild(backdrop);
  }

  function row(label, input) {
    return el('div', { class: 'row' }, [el('label', {}, label), input]);
  }

  // ----- Weekly Ledger -----
  function renderLedger() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'topbar' }, [
      el('div', { class: 'title-block' }, [
        el('div', { class: 'eyebrow' }, 'Cash flow'),
        el('h1', {}, 'Weekly Ledger')
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', onClick: () => addLedgerRow() }, '+ Add entry'),
        el('button', { class: 'btn', onClick: exportJSON }, 'Export data.json')
      ])
    ]));

    // Filters
    const pFilter = el('select', {}, [
      el('option', { value: 'all' }, 'All projects'),
      ...state.data.projects.map(p => el('option', { value: p.id }, p.name))
    ]);
    pFilter.value = state.filters.projectFilter;
    pFilter.addEventListener('change', () => { state.filters.projectFilter = pFilter.value; renderAll(); });

    wrap.appendChild(el('div', { class: 'filters' }, [
      el('label', {}, 'Project'), pFilter
    ]));

    // Summary by expense type
    const byType = {};
    for (const row of state.data.weekly_ledger) {
      if (state.filters.projectFilter !== 'all' && row.project_id !== state.filters.projectFilter) continue;
      const t = row.expense_type || 'Other';
      byType[t] = (byType[t] || 0) + (row.amount || 0);
    }
    const total = Object.values(byType).reduce((a, b) => a + b, 0);

    if (Object.keys(byType).length) {
      const kpiGrid = el('div', { class: 'kpi-grid' });
      kpiGrid.appendChild(kpi('Total deployed', fmtMoney(total), 'across filter'));
      for (const et of state.data.taxonomies.expense_types) {
        if (byType[et]) kpiGrid.appendChild(kpi(et, fmtMoney(byType[et])));
      }
      wrap.appendChild(kpiGrid);
    }

    if (!state.data.weekly_ledger.length) {
      wrap.appendChild(el('div', { class: 'empty' }, 'No ledger entries yet. Click "+ Add entry" to log a weekly expense.'));
      return wrap;
    }

    const tableWrap = el('div', { class: 'table-wrap' });
    const rows = state.data.weekly_ledger
      .filter(r => state.filters.projectFilter === 'all' || r.project_id === state.filters.projectFilter)
      .slice()
      .sort((a, b) => (b.week_of || '').localeCompare(a.week_of || ''));

    const tbl = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, [
        th('Week of'), th('Project'), th('Expense type'), th('Workstream'), th('Amount'), th('Vendor / description'), th('Status'), th('')
      ])),
      el('tbody', {}, rows.map(r => el('tr', {}, [
        el('td', {}, editDate(r, 'week_of')),
        el('td', {}, projectSelect(r, 'project_id')),
        el('td', {}, editSelect(r, 'expense_type', state.data.taxonomies.expense_types)),
        el('td', {}, editSelect(r, 'workstream', state.data.taxonomies.workstreams)),
        el('td', { class: 'num' }, editNumber(r, 'amount')),
        el('td', {}, editText(r, 'description', null, 'Vendor / note...')),
        el('td', {}, editSelect(r, 'status', ['Projected', 'Committed', 'Paid'])),
        el('td', { style: 'text-align:right' },
          el('button', { class: 'btn sm danger ghost', onClick: () => deleteLedgerRow(r.id) }, 'Remove')
        )
      ])))
    ]);
    tableWrap.appendChild(tbl);
    wrap.appendChild(tableWrap);

    return wrap;
  }

  function projectSelect(obj, field) {
    const sel = el('select', { class: 'edit' });
    sel.appendChild(el('option', { value: '' }, '—'));
    for (const p of state.data.projects) {
      const o = el('option', { value: p.id }, p.name);
      if (obj[field] === p.id) o.setAttribute('selected', 'selected');
      sel.appendChild(o);
    }
    sel.value = obj[field] || '';
    sel.addEventListener('change', () => {
      const v = sel.value || null;
      if (v !== obj[field]) {
        obj[field] = v;
        markDirty(); saveWorkingCopy();
      }
    });
    return sel;
  }

  function addLedgerRow() {
    if (!state.data.weekly_ledger) state.data.weekly_ledger = [];
    const id = 'wl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    state.data.weekly_ledger.push({
      id,
      week_of: todayISO(),
      project_id: null,
      expense_type: null,
      workstream: null,
      amount: null,
      description: null,
      status: 'Projected'
    });
    markDirty(); saveWorkingCopy();
    renderAll();
  }

  function deleteLedgerRow(id) {
    state.data.weekly_ledger = state.data.weekly_ledger.filter(r => r.id !== id);
    markDirty(); saveWorkingCopy();
    renderAll();
  }

  // ----- Monthly Plan -----
  function renderMonthlyPlan() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'topbar' }, [
      el('div', { class: 'title-block' }, [
        el('div', { class: 'eyebrow' }, 'Capital allocation'),
        el('h1', {}, 'Monthly Plan')
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', onClick: () => addMonthlyRow() }, '+ Add row'),
        el('button', { class: 'btn', onClick: exportJSON }, 'Export data.json')
      ])
    ]));

    if (!state.data.monthly_plan || !state.data.monthly_plan.length) {
      wrap.appendChild(el('div', { class: 'empty' }, 'No monthly plan rows yet. Click "+ Add row" to plan a capital deployment.'));
      return wrap;
    }

    const rows = state.data.monthly_plan
      .slice()
      .sort((a, b) => (a.month || '').localeCompare(b.month || ''));

    // Pivot: rows = project, columns = months, cells = planned amount
    const projects = state.data.projects;
    const monthsSet = new Set();
    for (const r of rows) if (r.month) monthsSet.add(r.month);
    const months = Array.from(monthsSet).sort();

    // Editable flat table first
    const tableWrap = el('div', { class: 'table-wrap' });
    const tbl = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, [
        th('Month'), th('Project'), th('Category'), th('Planned $'), th('Actual $'), th('Notes'), th('')
      ])),
      el('tbody', {}, rows.map(r => el('tr', {}, [
        el('td', {}, el('input', {
          class: 'edit',
          type: 'month',
          value: r.month || '',
          onChange: (e) => { r.month = e.target.value || null; markDirty(); saveWorkingCopy(); }
        })),
        el('td', {}, projectSelect(r, 'project_id')),
        el('td', {}, editSelect(r, 'category', state.data.taxonomies.expense_types)),
        el('td', { class: 'num' }, editNumber(r, 'planned')),
        el('td', { class: 'num' }, editNumber(r, 'actual')),
        el('td', {}, editText(r, 'notes', null, 'Notes...')),
        el('td', { style: 'text-align:right' },
          el('button', { class: 'btn sm danger ghost', onClick: () => {
            state.data.monthly_plan = state.data.monthly_plan.filter(x => x.id !== r.id);
            markDirty(); saveWorkingCopy(); renderAll();
          } }, 'Remove')
        )
      ])))
    ]);
    tableWrap.appendChild(tbl);
    wrap.appendChild(tableWrap);

    // Pivot summary
    if (months.length) {
      wrap.appendChild(el('h2', { style: 'margin:26px 0 10px' }, 'Summary by project × month'));
      const pWrap = el('div', { class: 'table-wrap' });
      const pTbl = el('table', { class: 'data' });
      const head = el('thead', {}, el('tr', {}, [
        th('Project'),
        ...months.map(m => th(m)),
        th('Total')
      ]));
      const body = el('tbody', {}, projects.map(p => {
        const cells = [el('td', {}, el('strong', {}, p.short_name || p.name))];
        let rowTotal = 0;
        for (const m of months) {
          const matches = rows.filter(r => r.project_id === p.id && r.month === m);
          const amt = matches.reduce((a, b) => a + (b.planned || 0), 0);
          rowTotal += amt;
          cells.push(el('td', { class: 'num' }, amt ? fmtMoney(amt) : '—'));
        }
        cells.push(el('td', { class: 'num' }, el('strong', {}, fmtMoney(rowTotal))));
        return el('tr', {}, cells);
      }));
      // Totals row
      const footCells = [el('td', {}, el('strong', {}, 'Total'))];
      let grand = 0;
      for (const m of months) {
        const total = rows.filter(r => r.month === m).reduce((a, b) => a + (b.planned || 0), 0);
        grand += total;
        footCells.push(el('td', { class: 'num' }, el('strong', {}, total ? fmtMoney(total) : '—')));
      }
      footCells.push(el('td', { class: 'num' }, el('strong', {}, fmtMoney(grand))));
      const foot = el('tfoot', {}, el('tr', { style: 'background:var(--porcelain-warm)' }, footCells));
      pTbl.appendChild(head); pTbl.appendChild(body); pTbl.appendChild(foot);
      pWrap.appendChild(pTbl);
      wrap.appendChild(pWrap);
    }

    return wrap;
  }

  function addMonthlyRow() {
    if (!state.data.monthly_plan) state.data.monthly_plan = [];
    const id = 'mp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    state.data.monthly_plan.push({
      id,
      month,
      project_id: null,
      category: null,
      planned: null,
      actual: null,
      notes: null
    });
    markDirty(); saveWorkingCopy();
    renderAll();
  }

  // ----- Export link in sidebar -----
  function wireSidebar() {
    const link = $('#export-link');
    if (link) {
      link.addEventListener('click', (e) => { e.preventDefault(); exportJSON(); });
    }
  }

  // ----- Init -----
  async function init() {
    await loadData();
    wireSidebar();
    renderAll();
    // Expose for debugging
    window.KCM = state;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
