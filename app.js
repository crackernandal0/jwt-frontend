const API = window.API_URL;
const $ = (sel) => document.querySelector(sel);

let token = localStorage.getItem('token');
let me = null;

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && token) logout();
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}

function flash(text, isError = false) {
  const m = $('#msg');
  m.textContent = text;
  m.className = isError ? 'error' : '';
  clearTimeout(flash.t);
  flash.t = setTimeout(() => m.classList.add('hidden'), 4000);
}

const safe = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (e) {
    flash(e.message, true);
  }
};

const splitList = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
const fmtDate = (d) => new Date(d).toLocaleString();

function renderPager(container, res, load) {
  container.replaceChildren(
    h('button', { onclick: () => load(res.page - 1), ...(res.page <= 1 && { disabled: '' }) }, 'Prev'),
    h('span', {}, `Page ${res.page} of ${Math.max(1, res.totalPages)} (${res.total} total)`),
    h('button', { onclick: () => load(res.page + 1), ...(res.page >= res.totalPages && { disabled: '' }) }, 'Next')
  );
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setSession(data) {
  token = data.token;
  localStorage.setItem('token', token);
  me = data.user;
  showApp();
}

function logout() {
  token = null;
  me = null;
  localStorage.removeItem('token');
  $('#main').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#logout').classList.add('hidden');
  $('#who').textContent = '';
}

$('#loginForm').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  setSession(await api('POST', '/auth/login', formData(e.target)));
  e.target.reset();
}));

$('#registerForm').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  const f = formData(e.target);
  setSession(await api('POST', '/auth/register', { ...f, interests: splitList(f.interests) }));
  e.target.reset();
  flash('Account created');
}));

$('#logout').addEventListener('click', logout);

function showApp() {
  $('#auth').classList.add('hidden');
  $('#main').classList.remove('hidden');
  $('#logout').classList.remove('hidden');
  $('#who').textContent = `${me.name} (${me.role})`;
  document.querySelectorAll('.admin').forEach((b) => b.classList.toggle('hidden', me.role !== 'admin'));
  openTab('notes');
}

const loaders = {
  notes: () => loadNotes(1),
  posts: () => loadPosts(me._id, 1),
  interests: () => loadInterests(1),
  profile: fillProfile,
  adminUsers: () => loadUsers(1),
  adminNotes: () => loadAdminNotes(1),
};

function openTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${name}`));
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  safe(loaders[name])();
}
$('#tabs').addEventListener('click', (e) => e.target.dataset.tab && openTab(e.target.dataset.tab));

let notesPage = 1;
async function loadNotes(page) {
  notesPage = page;
  const res = await api('GET', `/notes?page=${page}&limit=5`);
  $('#notesList').replaceChildren(
    ...(res.data.length ? res.data.map(noteCard) : [h('p', { class: 'muted' }, 'No notes yet.')])
  );
  renderPager($('#notesPager'), res, safe(loadNotes));
}

function noteCard(n) {
  return h('div', { class: 'card' },
    h('h4', {}, n.title),
    h('p', {}, n.content),
    h('div', { class: 'muted' }, `Updated ${fmtDate(n.updatedAt)} `),
    h('button', { onclick: () => editNote(n) }, 'Edit'), ' ',
    h('button', { onclick: safe(async () => {
      if (!confirm('Delete this note?')) return;
      await api('DELETE', `/notes/${n._id}`);
      flash('Note deleted');
      await loadNotes(notesPage);
    }) }, 'Delete')
  );
}

function editNote(n) {
  const f = $('#noteForm');
  f.editId.value = n._id;
  f.title.value = n.title;
  f.content.value = n.content;
  $('#noteFormTitle').textContent = 'Edit note';
  $('#noteCancel').classList.remove('hidden');
  f.title.focus();
}

function resetNoteForm() {
  $('#noteForm').reset();
  $('#noteForm').editId.value = '';
  $('#noteFormTitle').textContent = 'New note';
  $('#noteCancel').classList.add('hidden');
}
$('#noteCancel').addEventListener('click', resetNoteForm);

$('#noteForm').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  const { editId: id, title, content } = formData(e.target);
  if (id) await api('PATCH', `/notes/${id}`, { title, content });
  else await api('POST', '/notes', { title, content });
  flash(id ? 'Note updated' : 'Note created');
  resetNoteForm();
  await loadNotes(id ? notesPage : 1);
}));

let postsUser = null;
async function loadPosts(userId, page) {
  postsUser = userId;
  const res = await api('GET', `/users/${encodeURIComponent(userId)}/posts?page=${page}&limit=5`);
  $('#postsHeading').textContent = `Posts by ${res.author.name}`;
  $('#postsList').replaceChildren(
    ...(res.data.length
      ? res.data.map((p) => h('div', { class: 'card' },
          h('h4', {}, p.title),
          h('p', {}, p.body),
          h('div', { class: 'muted' }, fmtDate(p.createdAt)),
          (userId === me._id || me.role === 'admin')
            ? h('button', { onclick: safe(async () => {
                await api('DELETE', `/posts/${p._id}`);
                await loadPosts(userId, page);
              }) }, 'Delete')
            : null
        ))
      : [h('p', { class: 'muted' }, 'No posts.')])
  );
  renderPager($('#postsPager'), res, safe((p) => loadPosts(userId, p)));
}

$('#postForm').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  await api('POST', '/posts', formData(e.target));
  e.target.reset();
  flash('Post published');
  await loadPosts(me._id, 1);
}));

$('#postsLookupForm').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  await loadPosts(formData(e.target).userId.trim(), 1);
}));
$('#myPostsBtn').addEventListener('click', safe(() => loadPosts(me._id, 1)));

function showPostsOf(userId) {
  openTab('posts');
  safe(() => loadPosts(userId, 1))();
}

let interestFilter = '';
async function loadInterests(page) {
  const q = interestFilter ? `&interest=${encodeURIComponent(interestFilter)}` : '';
  const res = await api('GET', `/users/interests?page=${page}&limit=5${q}`);
  $('#interestsList').replaceChildren(
    ...(res.data.length
      ? res.data.map((g) => h('div', { class: 'card' },
          h('h4', {}, `${g.interest} (${g.count})`),
          h('div', {}, ...g.users.map((u, i) => [
            i ? ', ' : '',
            h('a', { title: 'View posts', onclick: () => showPostsOf(u._id) }, u.name + (u.email ? ` <${u.email}>` : '')),
          ]))
        ))
      : [h('p', { class: 'muted' }, 'No users with interests.')])
  );
  renderPager($('#interestsPager'), res, safe(loadInterests));
}

$('#interestFilter').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  interestFilter = formData(e.target).interest.trim();
  await loadInterests(1);
}));

async function fillProfile() {
  me = (await api('GET', '/auth/me')).user;
  const f = $('#profileForm');
  f.name.value = me.name;
  f.interests.value = me.interests.join(', ');
  f.password.value = '';
  $('#profileInfo').textContent = `${me.email} Â· role: ${me.role} Â· id: ${me._id}`;
}

$('#profileForm').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  const f = formData(e.target);
  const body = { name: f.name, interests: splitList(f.interests) };
  if (f.password) body.password = f.password;
  me = (await api('PATCH', '/users/me', body)).user;
  $('#who').textContent = `${me.name} (${me.role})`;
  flash('Profile saved');
  await fillProfile();
}));

let usersPage = 1;
async function loadUsers(page) {
  usersPage = page;
  const res = await api('GET', `/admin/users?page=${page}&limit=10`);
  $('#usersBody').replaceChildren(
    ...res.data.map((u) => h('tr', {},
      h('td', {}, u.name),
      h('td', {}, u.email),
      h('td', {}, u.role),
      h('td', {}, u.interests.join(', ')),
      h('td', {},
        h('button', { onclick: () => editUser(u) }, 'Edit'), ' ',
        h('button', { onclick: () => { openTab('adminNotes'); $('#adminNotesFilter').owner.value = u._id; adminNotesOwner = u._id; safe(() => loadAdminNotes(1))(); } }, 'Notes'), ' ',
        h('button', { onclick: () => showPostsOf(u._id) }, 'Posts'), ' ',
        u._id === me._id ? null : h('button', { onclick: safe(async () => {
          if (!confirm(`Delete ${u.email} and all their notes and posts?`)) return;
          await api('DELETE', `/admin/users/${u._id}`);
          flash('User deleted');
          await loadUsers(usersPage);
        }) }, 'Delete')
      )
    ))
  );
  renderPager($('#usersPager'), res, safe(loadUsers));
}

function editUser(u) {
  const f = $('#userForm');
  f.editId.value = u._id;
  f.name.value = u.name;
  f.email.value = u.email;
  f.password.value = '';
  f.role.value = u.role;
  f.interests.value = u.interests.join(', ');
  $('#userFormTitle').textContent = 'Edit user';
  $('#userCancel').classList.remove('hidden');
}

function resetUserForm() {
  $('#userForm').reset();
  $('#userForm').editId.value = '';
  $('#userFormTitle').textContent = 'Add user';
  $('#userCancel').classList.add('hidden');
}
$('#userCancel').addEventListener('click', resetUserForm);

$('#userForm').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  const { editId: id, password, interests, ...rest } = formData(e.target);
  const body = { ...rest, interests: splitList(interests) };
  if (password) body.password = password;
  if (id) await api('PATCH', `/admin/users/${id}`, body);
  else {
    if (!password) throw new Error('Password is required for a new user');
    await api('POST', '/admin/users', body);
  }
  flash(id ? 'User updated' : 'User created');
  resetUserForm();
  await loadUsers(id ? usersPage : 1);
}));

let adminNotesOwner = '';
async function loadAdminNotes(page) {
  const q = adminNotesOwner ? `&owner=${encodeURIComponent(adminNotesOwner)}` : '';
  const res = await api('GET', `/admin/notes?page=${page}&limit=10${q}`);
  $('#adminNotesList').replaceChildren(
    ...(res.data.length
      ? res.data.map((n) => h('div', { class: 'card' },
          h('h4', {}, n.title),
          h('p', {}, n.content),
          h('div', { class: 'muted' }, `by ${n.owner ? `${n.owner.name} <${n.owner.email}>` : 'deleted user'} Â· ${fmtDate(n.createdAt)}`)
        ))
      : [h('p', { class: 'muted' }, 'No notes.')])
  );
  renderPager($('#adminNotesPager'), res, safe(loadAdminNotes));
}

$('#adminNotesFilter').addEventListener('submit', safe(async (e) => {
  e.preventDefault();
  adminNotesOwner = formData(e.target).owner.trim();
  await loadAdminNotes(1);
}));

if (token) {
  api('GET', '/auth/me')
    .then((d) => { me = d.user; showApp(); })
    .catch(logout);
}
