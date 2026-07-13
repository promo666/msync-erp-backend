// ---------- Super Admin session handling (separate token, never mixed with warehouse login) ----------
document.getElementById('superAdminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('saEmailInput').value.trim();
  const password = document.getElementById('saPasswordInput').value;
  const errBox = document.getElementById('superAdminLoginError');
  const btn = document.getElementById('superAdminLoginBtn');
  errBox.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Signing in...';

  try {
    const res = await fetch(API_BASE + '/superadmin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    app.saToken = data.token;
    app.saUser = data.admin;
    sessionStorage.setItem('msync_sa_token', app.saToken);
    sessionStorage.setItem('msync_sa_user', JSON.stringify(app.saUser));
    app.showSuperAdminApp();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i> Sign In';
  }
});

MSyncApp.prototype.checkSuperAdminSession = function () {
  const token = sessionStorage.getItem('msync_sa_token');
  const user = JSON.parse(sessionStorage.getItem('msync_sa_user') || 'null');
  // Only auto-restore the super-admin session if there ISN'T already an active
  // regular warehouse session showing — regular login always takes priority
  // on load so the two are never confused.
  if (token && user && !this.token) {
    this.saToken = token;
    this.saUser = user;
    this.showSuperAdminApp();
  }
};

MSyncApp.prototype.saApi = async function (path, { method = 'GET', body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (this.saToken) headers['Authorization'] = 'Bearer ' + this.saToken;
  let res;
  try {
    res = await fetch(API_BASE + '/superadmin' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new Error('Could not reach the server. Check your connection.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) {
    this.superAdminLogout(true);
    throw new Error('Session expired, please log in again');
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
};

MSyncApp.prototype.superAdminLogout = function (skipRedirectMessage) {
  this.saToken = null;
  this.saUser = null;
  sessionStorage.removeItem('msync_sa_token');
  sessionStorage.removeItem('msync_sa_user');
  this.showSuperAdminLogin();
  if (!skipRedirectMessage) this.showToast('Logged out', 'success');
};

MSyncApp.prototype.showSuperAdminApp = function () {
  this.hideAllScreens();
  document.getElementById('superAdminApp').classList.remove('hidden');
  this.renderSuperAdminOverview();
};

// ---------- Overview: combined totals + warehouse ranking ----------
MSyncApp.prototype.renderSuperAdminOverview = async function () {
  const content = document.getElementById('superAdminContent');
  content.innerHTML = '<div class="flex items-center justify-center h-64"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-700"></div></div>';

  try {
    const [overview, warehouses] = await Promise.all([
      this.saApi('/reports/overview'),
      this.saApi('/warehouses')
    ]);

    content.innerHTML = `
    <div class="fade-in space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="glass-panel rounded-xl p-5">
          <p class="text-sm text-gray-500">Total Warehouses</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">${warehouses.length}</p>
        </div>
        <div class="glass-panel rounded-xl p-5">
          <p class="text-sm text-gray-500">Combined Sales (all warehouses)</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">${this.fmt(overview.combined.total_sales)}</p>
        </div>
        <div class="glass-panel rounded-xl p-5">
          <p class="text-sm text-gray-500">Total Completed Sales</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">${overview.combined.total_sale_count}</p>
        </div>
      </div>

      <div class="glass-panel rounded-xl shadow-sm overflow-hidden">
        <div class="p-4 border-b border-gray-100 font-semibold text-gray-800">Warehouse Ranking (by total sales)</div>
        <table class="w-full text-sm">
          <thead class="bg-gray-50"><tr class="text-left text-gray-500">
            <th class="p-3">#</th><th class="p-3">Warehouse</th><th class="p-3 text-right">Total Sales</th><th class="p-3 text-right">Sale Count</th><th class="p-3 text-right">Details</th>
          </tr></thead>
          <tbody>
            ${overview.ranking.map((r, i) => `
            <tr class="transaction-row border-b border-gray-50">
              <td class="p-3 text-gray-400">${i + 1}</td>
              <td class="p-3 font-medium">${this.esc(r.warehouse_name)}</td>
              <td class="p-3 text-right font-semibold">${this.fmt(r.total_sales)}</td>
              <td class="p-3 text-right">${r.sale_count}</td>
              <td class="p-3 text-right"><button onclick="app.renderSuperAdminWarehouseDetail('${r.warehouse_id}')" class="text-blue-600 hover:underline text-xs">View <i class="fas fa-arrow-right ml-1"></i></button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="glass-panel rounded-xl shadow-sm overflow-hidden">
        <div class="p-4 border-b border-gray-100 font-semibold text-gray-800">All Warehouses</div>
        <table class="w-full text-sm">
          <thead class="bg-gray-50"><tr class="text-left text-gray-500">
            <th class="p-3">Name</th><th class="p-3">Status</th><th class="p-3 text-right">Users</th><th class="p-3 text-right">Products</th><th class="p-3 text-right">Shops</th><th class="p-3 text-right">Actions</th>
          </tr></thead>
          <tbody>
            ${warehouses.map(w => `
            <tr class="transaction-row border-b border-gray-50">
              <td class="p-3 font-medium">${this.esc(w.name)}</td>
              <td class="p-3"><span class="px-2 py-0.5 rounded-full text-xs ${w.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${w.is_active ? 'Active' : 'Inactive'}</span></td>
              <td class="p-3 text-right">${w.stats.active_users}</td>
              <td class="p-3 text-right">${w.stats.active_products}</td>
              <td class="p-3 text-right">${w.stats.active_shops}</td>
              <td class="p-3 text-right space-x-2">
                <button onclick="app.renderSuperAdminWarehouseDetail('${w.id}')" class="text-blue-600 hover:underline text-xs">View</button>
                <button onclick="app.toggleWarehouseStatus('${w.id}', ${!w.is_active})" class="text-xs ${w.is_active ? 'text-red-600' : 'text-green-600'} hover:underline">${w.is_active ? 'Deactivate' : 'Activate'}</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  } catch (err) {
    content.innerHTML = `<div class="text-center text-red-600 py-12"><i class="fas fa-exclamation-triangle text-3xl mb-3"></i><p>${err.message}</p></div>`;
  }
};

MSyncApp.prototype.toggleWarehouseStatus = async function (warehouseId, activate) {
  try {
    await this.saApi(`/warehouses/${warehouseId}/status`, { method: 'PATCH', body: { is_active: activate } });
    this.showToast(activate ? 'Warehouse activated' : 'Warehouse deactivated', 'success');
    this.renderSuperAdminOverview();
  } catch (err) { this.showToast(err.message, 'error'); }
};

// ---------- Drill into a single warehouse ----------
MSyncApp.prototype.renderSuperAdminWarehouseDetail = async function (warehouseId) {
  const content = document.getElementById('superAdminContent');
  content.innerHTML = '<div class="flex items-center justify-center h-64"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-700"></div></div>';

  try {
    const d = await this.saApi(`/warehouses/${warehouseId}/dashboard`);
    content.innerHTML = `
    <div class="fade-in space-y-6">
      <button onclick="app.renderSuperAdminOverview()" class="text-sm text-gray-500 hover:underline"><i class="fas fa-arrow-left mr-1"></i>Back to all warehouses</button>
      <h2 class="text-xl font-bold text-gray-900">${this.esc(d.warehouse.name)}</h2>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="glass-panel rounded-xl p-5">
          <p class="text-sm text-gray-500">Total Sales</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">${this.fmt(d.totals.total_sales)}</p>
        </div>
        <div class="glass-panel rounded-xl p-5">
          <p class="text-sm text-gray-500">Completed Sales</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">${d.totals.sale_count}</p>
        </div>
      </div>

      <div class="glass-panel rounded-xl shadow-sm overflow-hidden">
        <div class="p-4 border-b border-gray-100 font-semibold text-gray-800">Low Stock Products</div>
        ${d.lowStock.length === 0 ? '<p class="p-4 text-sm text-gray-400">No low-stock products.</p>' : `
        <table class="w-full text-sm">
          <thead class="bg-gray-50"><tr class="text-left text-gray-500"><th class="p-3">SKU</th><th class="p-3">Name</th><th class="p-3 text-right">Stock</th><th class="p-3 text-right">Threshold</th></tr></thead>
          <tbody>${d.lowStock.map(p => `<tr class="border-b border-gray-50"><td class="p-3">${this.esc(p.sku)}</td><td class="p-3">${this.esc(p.name)}</td><td class="p-3 text-right stock-low px-2 rounded">${p.current_stock}</td><td class="p-3 text-right">${p.low_stock_threshold}</td></tr>`).join('')}</tbody>
        </table>`}
      </div>

      <div class="glass-panel rounded-xl shadow-sm overflow-hidden">
        <div class="p-4 border-b border-gray-100 font-semibold text-gray-800">Top Products</div>
        <table class="w-full text-sm">
          <thead class="bg-gray-50"><tr class="text-left text-gray-500"><th class="p-3">Name</th><th class="p-3 text-right">Units Sold</th><th class="p-3 text-right">Revenue</th></tr></thead>
          <tbody>${d.topProducts.map(p => `<tr class="border-b border-gray-50"><td class="p-3">${this.esc(p.name)}</td><td class="p-3 text-right">${p.units_sold}</td><td class="p-3 text-right">${this.fmt(p.revenue)}</td></tr>`).join('')}</tbody>
        </table>
      </div>

      <div class="glass-panel rounded-xl shadow-sm overflow-hidden">
        <div class="p-4 border-b border-gray-100 font-semibold text-gray-800">Recent Sales</div>
        <table class="w-full text-sm">
          <thead class="bg-gray-50"><tr class="text-left text-gray-500"><th class="p-3">Invoice</th><th class="p-3">Salesman</th><th class="p-3 text-right">Total</th><th class="p-3">Status</th></tr></thead>
          <tbody>${d.recentSales.map(s => `<tr class="border-b border-gray-50"><td class="p-3">${this.esc(s.invoice_number)}</td><td class="p-3">${this.esc(s.salesman_name)}</td><td class="p-3 text-right">${this.fmt(s.total_amount)}</td><td class="p-3">${this.esc(s.status)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  } catch (err) {
    content.innerHTML = `<div class="text-center text-red-600 py-12"><i class="fas fa-exclamation-triangle text-3xl mb-3"></i><p>${err.message}</p></div>`;
  }
};
