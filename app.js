/**
 * Equatorial Pará - DSC Reports Dashboard Engine
 * Handles high-performance client-side CSV parsing, IndexedDB persistence,
 * compliance gap analysis (pending modules), dynamic filters, Chart.js visualizations,
 * and cost center cross-referencing with CUBOS.
 */

// 28 Official DSC Themes
const OFFICIAL_THEMES = [
    "TEMA 1 - COMUNICACAO NAO VIOLENTA",
    "TEMA 2 - ATENDIMENTO HUMANIZADO",
    "TEMA 3 - COMUNICACAO CLARA E EFICAZ",
    "TEMA 4 - POSTURA E APRESENTACAO PROFISSIONAL",
    "TEMA 5 - RESOLUCAO DE CONFLITOS",
    "TEMA 6 - ETICA NO ATENDIMENTO AO CLIENTE",
    "TEMA 7 - PEDIDO DE PROPINA O QUE E E COMO AGIR",
    "TEMA 8 - SERVICO MAL EXECUTADO E SUAS CONSEQUENCIAS",
    "TEMA 9 - DESVIO DE FUNCAO O QUE PODE E O QUE NAO PODE",
    "TEMA 10 - RESPEITO AO CLIENTE E AO PATRIMONIO",
    "TEMA 11 - MA CONDUTA NO ATENDIMENTO AO CLIENTE",
    "TEMA 12 - POSTURA E APRESENTACAO PROFISSIONAL",
    "TEMA 13 - FINALIZACAO CORRETA DO ATENDIMENTO",
    "TEMA 14 - LINGUAGEM CORPORAL E COMPORTAMENTO NO LOCAL",
    "TEMA 15 - RESPONSABILIDADE SOBRE O SERVICO EXECUTADO",
    "TEMA 16 - COMO AGIR DURANTE A EXECUCAO DO SERVICO DE CORTE",
    "TEMA 17 - USO ADEQUADO DO CELULAR DURANTE O ATENDIMENTO",
    "TEMA 18 - COMO AGIR DIANTE DE RECLAMACOES DO CLIENTE",
    "TEMA 19 - NOVA FATURA DE ENERGIA COMO ORIENTAR O CLIENTE",
    "TEMA 20 - PEQUENAS ATITUDES QUE FAZEM DIFERENCA PARA O CLIENTE",
    "TEMA 21 - APRENDENDO COM OS ERROS DO DIA A DIA",
    "TEMA 22 - QUANDO E COMO ACIONAR A LIDERANCA",
    "TEMA 23 - COMPORTAMENTOS QUE GERAM RECLAMACOES",
    "TEMA 24 - NOVA COMUNICACAO COM O CLIENTE EM INTERRUPCOES DE ENERGIA",
    "TEMA 25 - TRANSPARENCIA NAS INFORMACOES",
    "TEMA 26 - COMO EVITAR RETRABALHO E RETORNOS DESNECESSARIOS",
    "TEMA 27 - RESPONSABILIDADE SOCIAL NO ATENDIMENTO AO CLIENTE",
    "TEMA 28 - COMO LIDAR COM CLIENTES EXALTADOS OU NERVOSOS"
];

// Matrículas of employees who are no longer part of regional Sul and should be excluded from reports
const IGNORED_MATRICULAS = new Set([
    "19971" // Leandro Brito Ranieri
]);

// Application Global State
const state = {
    rawRecords: [],       // Raw normalized submissions from CSV
    collaborators: {},    // Map: matricula -> { profile, completedThemes: { theme: { date, score } } }
    cubosData: {},        // Map: chapa -> { cc, secao, funcao, situacao }
    masterThemes: [...OFFICIAL_THEMES],     // Array of all 28 official themes
    uniqueRegionals: [],
    uniqueManagers: [],
    uniqueCompanies: [],
    uniqueFrentes: [],
    uniqueCCs: [],        // Unique Cost Centers from CUBOS sheet
    
    // Filter states
    filters: {
        search: '',
        tema: '',
        regional: '',
        gerente: '',
        tipo: '',
        empresa: '',
        frente: '',
        cc: []            // Multiselect Centro de Custo filter array
    },
    
    // Pagination states
    complianceTable: {
        currentPage: 1,
        pageSize: 15,
        filteredData: []
    },
    databaseTable: {
        currentPage: 1,
        pageSize: 15,
        filteredData: []
    },
    
    // Selected collaborator for details
    selectedEmployeeMatricula: null,
    
    // Chart instances (to destroy before re-render)
    charts: {
        history: null,
        empresas: null,
        gerentes: null,
        funcoes: null,
        temas: null
    }
};

// IndexedDB Helper Functions
const dbName = 'DscDashboardDB';
const storeName = 'csvDataStore';

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = function(e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: 'id' });
            }
        };
        request.onsuccess = function(e) {
            resolve(e.target.result);
        };
        request.onerror = function(e) {
            reject('Erro ao abrir o IndexedDB: ' + e.target.error);
        };
    });
}

function saveToDB(records, id = 'current_dataset') {
    return initDB().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const putRequest = store.put({ id: id, data: records, updatedAt: new Date().toISOString() });
            
            putRequest.onsuccess = function() {
                resolve();
            };
            putRequest.onerror = function(e) {
                reject('Erro ao salvar dados no IndexedDB: ' + e.target.error);
            };
        });
    });
}

function loadFromDB(id = 'current_dataset') {
    return initDB().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const getRequest = store.get(id);
            
            getRequest.onsuccess = function(e) {
                if (e.target.result) {
                    resolve(e.target.result.data);
                } else {
                    resolve(null);
                }
            };
            getRequest.onerror = function(e) {
                reject('Erro ao carregar dados do IndexedDB: ' + e.target.error);
            };
        });
    });
}

function clearDB() {
    return initDB().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    });
}

// UI Notification Toast
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'danger') iconClass = 'fa-circle-xmark';
    
    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i><span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Normalizes theme name based on theme number matching to official themes list
function normalizeThemeName(rawTema) {
    if (!rawTema) return '';
    const match = rawTema.match(/TEMA\s*(\d+)/i);
    if (match) {
        const themeNum = parseInt(match[1], 10);
        if (themeNum >= 1 && themeNum <= OFFICIAL_THEMES.length) {
            return OFFICIAL_THEMES[themeNum - 1];
        }
    }
    return rawTema.trim().toUpperCase();
}

// Normalizes raw parsed CSV rows
function normalizeData(parsedRows) {
    const normalized = [];
    const regionalsSet = new Set();
    const managersSet = new Set();
    const companiesSet = new Set();
    const frentesSet = new Set();
    const ccSet = new Set();

    parsedRows.forEach((row, index) => {
        // Skip empty rows or header duplicate rows
        if (!row['MATRICULA'] && !row['NOME COMPLETO']) return;

        // Populate master themes using the 28 official themes checklist
        const rawTema = normalizeThemeName(row['CONFIRME O TEMA DO DSC'] || '');

        // Clean up basic text fields
        const rawProprioParceira = (row['PROPRIO OU PARCEIRA?'] || '').trim().toUpperCase();
        const rawGrupoEmpresa = (row['EMPRESA DO GRUPO'] || '').trim().toUpperCase();
        const rawParceiraEmpresa = (row['EMPRESA'] || '').trim().toUpperCase();
        const rawRegional = (row['QUAL REGIONAL?'] || '').trim().toUpperCase();

        let finalEmpresa = rawProprioParceira.includes('PROPRIO') ? (rawGrupoEmpresa || 'EQUATORIAL') : (rawParceiraEmpresa || 'PARCEIRA NÃO INFORMADA');
        
        // Normalize CGB company names to a single unified string "CGB"
        if (finalEmpresa.toUpperCase().includes('CGB')) {
            finalEmpresa = 'CGB';
        }

        // --- FILTER REQUIREMENT: Keep ONLY CGB and Regional SUL ---
        const isCgb = finalEmpresa.includes('CGB');
        const isSul = rawRegional === 'SUL';
        if (!isCgb || !isSul) return;

        // Parse remaining fields
        const rawDateStr = row['Carimbo de data/hora'] || '';
        const rawScore = row['Pontuação'] || '0';
        const rawNome = (row['NOME COMPLETO'] || '').trim().toUpperCase();
        const rawMatricula = (row['MATRICULA'] || '').trim();
        const rawCidade = (row['CIDADE ONDE TRABALHA'] || '').trim().toUpperCase();
        const rawFrente = (row['Qual frente você atua?'] || '').trim();

        // Consolidate Manager (Check all 6 columns for conditional form logic)
        let rawGerente = '';
        const managerKeys = [
            'GERENTE EQUATORIAL - NORTE',
            'GERENTE EQUATORIAL - NORDESTE',
            'GERENTE EQUATORIAL - CENTRO',
            'GERENTE EQUATORIAL - OESTE',
            'GERENTE EQUATORIAL - SUL',
            'GERENTE EQUATORIAL - SEDE'
        ];
        for (let key of managerKeys) {
            if (row[key] && row[key].trim()) {
                rawGerente = row[key].trim().toUpperCase();
                break;
            }
        }

        // Clean up Score (e.g. "10/10", "10,00", "7" -> Number 10, 10, 7)
        let scoreVal = 0;
        if (typeof rawScore === 'number') {
            scoreVal = rawScore;
        } else {
            const cleanScore = rawScore.split('/')[0].replace(',', '.').trim();
            scoreVal = parseFloat(cleanScore) || 0;
        }

        // --- CUBOS CROSS-REFERENCE (Join by Matrícula / CHAPA) ---
        let chapaNorm = rawMatricula;
        if (!isNaN(parseFloat(rawMatricula))) {
            chapaNorm = String(Math.floor(parseFloat(rawMatricula)));
        } else {
            chapaNorm = rawMatricula.toLowerCase();
        }

        // Exclude ignored collaborators (e.g. Leandro Brito Ranieri, no longer part of regional Sul)
        if (IGNORED_MATRICULAS.has(chapaNorm)) return;

        const cubosCollab = state.cubosData[chapaNorm];
        if (!cubosCollab) {
            // Exclude terminated employees who are not on the active CUBOS roster
            return;
        }
        
        const finalCC = cubosCollab.cc || 'NÃO MAPEADO';
        const finalSecao = cubosCollab.secao || 'NÃO MAPEADA';
        const finalFuncao = cubosCollab.funcao || 'NÃO MAPEADA';
        const finalSituacao = cubosCollab.situacao || 'ATIVO';

        // Populate sets for dropdown filters (rawTema already added at the top)
        if (rawRegional) regionalsSet.add(rawRegional);
        if (rawGerente) managersSet.add(rawGerente);
        if (finalEmpresa) companiesSet.add(finalEmpresa);
        if (rawFrente) frentesSet.add(rawFrente);
        if (finalCC) ccSet.add(finalCC);

        normalized.push({
            id: index,
            timestamp: rawDateStr,
            score: scoreVal,
            tema: rawTema,
            nome: rawNome,
            matricula: chapaNorm,
            cidade: rawCidade,
            tipo: rawProprioParceira || 'NÃO INFORMADO',
            empresa: finalEmpresa,
            regional: rawRegional || 'NÃO INFORMADA',
            gerente: rawGerente || 'GERENTE NÃO INFORMADO',
            frente: rawFrente || 'NÃO INFORMADA',
            
            // Joined CUBOS columns
            cc: finalCC,
            secao: finalSecao,
            funcao: finalFuncao,
            situacao: finalSituacao
        });
    });

    state.masterThemes = [...OFFICIAL_THEMES];
    state.uniqueRegionals = Array.from(regionalsSet).sort();
    state.uniqueManagers = Array.from(managersSet).sort();
    state.uniqueCompanies = Array.from(companiesSet).sort();
    state.uniqueFrentes = Array.from(frentesSet).sort();
    state.uniqueCCs = Array.from(ccSet).sort();

    return normalized;
}

// Builds the matrix mapping employees to their submissions, identifying pending items
function buildCollaboratorComplianceMatrix() {
    const collabs = {};

    state.rawRecords.forEach(record => {
        const mat = record.matricula;
        if (!mat) return;

        // If collaborator doesn't exist, initialize
        if (!collabs[mat]) {
            collabs[mat] = {
                matricula: mat,
                nome: record.nome,
                cidade: record.cidade,
                tipo: record.tipo,
                empresa: record.empresa,
                regional: record.regional,
                gerente: record.gerente,
                frente: record.frente,
                
                // Joined CUBOS columns
                cc: record.cc,
                secao: record.secao,
                funcao: record.funcao,
                situacao: record.situacao,

                lastActive: record.timestamp,
                submissionsCount: 0,
                scoreSum: 0,
                completedThemes: {} // Map: theme -> { date, score }
            };
        }

        const c = collabs[mat];

        // Keep profile updated with latest active record data
        c.nome = record.nome;
        c.cidade = record.cidade;
        c.tipo = record.tipo;
        c.empresa = record.empresa;
        c.regional = record.regional;
        c.gerente = record.gerente;
        c.frente = record.frente;
        c.cc = record.cc;
        c.secao = record.secao;
        c.funcao = record.funcao;
        c.situacao = record.situacao;
        c.lastActive = record.timestamp;

        // Record training completion (only keep highest score if they did it multiple times)
        if (!c.completedThemes[record.tema] || record.score > c.completedThemes[record.tema].score) {
            c.completedThemes[record.tema] = {
                date: record.timestamp,
                score: record.score
            };
        }
    });

    // Handle collaborators who exist in CUBOS registry but have NOT submitted any DSC yet
    // This is critical to see 0% compliance employees who are completely pending!
    Object.keys(state.cubosData).forEach(chapa => {
        // Exclude ignored collaborators (Leandro Brito Ranieri)
        if (IGNORED_MATRICULAS.has(chapa)) return;
        
        // Since we are limited to CGB SUL, let's make sure we only add CUBOS employees who belong to CGB SUL
        // The CUBOS sheet only contains CGB SUL anyway, so we add all of them if not already created
        if (!collabs[chapa]) {
            const registry = state.cubosData[chapa];
            
            // Only add if active or active status not specified
            if (registry.situacao && registry.situacao !== 'ATIVO') return;

            collabs[chapa] = {
                matricula: chapa,
                nome: registry.nome || `COLABORADOR ${chapa}`,
                cidade: registry.cidade || 'SUL',
                tipo: 'PARCEIRA',
                empresa: 'CGB',
                regional: 'SUL',
                gerente: 'GERENTE NÃO DEFINIDO',
                frente: 'OPERACIONAL',
                
                cc: registry.cc,
                secao: registry.secao,
                funcao: registry.funcao,
                situacao: registry.situacao,

                lastActive: 'SEM ENVIO',
                submissionsCount: 0,
                scoreSum: 0,
                completedThemes: {}
            };
        }
    });

    // Post-process to calculate sums, scores, and compliance gap lists
    const totalThemesCount = state.masterThemes.length;

    Object.keys(collabs).forEach(mat => {
        const c = collabs[mat];
        const completedList = Object.keys(c.completedThemes);
        c.submissionsCount = completedList.length;

        // Calculate Average Score
        let sum = 0;
        completedList.forEach(t => {
            sum += c.completedThemes[t].score;
        });
        c.scoreSum = sum;
        c.averageScore = c.submissionsCount > 0 ? (sum / c.submissionsCount) : 0;

        // Calculate Gaps (Pending Themes)
        c.pendingThemes = state.masterThemes.filter(theme => !c.completedThemes[theme]);
        c.pendingCount = c.pendingThemes.length;
        c.complianceRate = totalThemesCount > 0 ? (c.submissionsCount / totalThemesCount) * 100 : 0;
    });

    state.collaborators = collabs;
}

// Custom Multiselect for Cost Center
function populateCcMultiselect() {
    const optionsContainer = document.getElementById('multiselect-cc-options');
    if (!optionsContainer) return;
    
    optionsContainer.innerHTML = '';
    
    // Sort uniqueCCs alphabetically/numerically
    const sortedCCs = [...state.uniqueCCs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    
    sortedCCs.forEach(cc => {
        if (!cc) return;
        const div = document.createElement('div');
        div.className = 'multiselect-option';
        div.dataset.value = cc;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = cc;
        checkbox.checked = state.filters.cc.includes(cc);
        
        const span = document.createElement('span');
        span.textContent = cc;
        
        div.appendChild(checkbox);
        div.appendChild(span);
        
        // Handle click on the whole option row
        div.addEventListener('click', function(e) {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
            }
            handleCcSelectionChange();
        });
        
        optionsContainer.appendChild(div);
    });
    
    updateCcMultiselectTriggerText();
}

function handleCcSelectionChange() {
    const checkboxes = document.querySelectorAll('#multiselect-cc-options input[type="checkbox"]');
    const selected = [];
    checkboxes.forEach(cb => {
        if (cb.checked) {
            selected.push(cb.value);
        }
    });
    state.filters.cc = selected;
    updateCcMultiselectTriggerText();
    applyFilters();
}

function updateCcMultiselectTriggerText() {
    const triggerText = document.querySelector('#multiselect-cc-trigger .multiselect-selected-text');
    if (!triggerText) return;
    
    if (state.filters.cc.length === 0) {
        triggerText.textContent = 'Todos os C. Custos';
    } else if (state.filters.cc.length === 1) {
        triggerText.textContent = state.filters.cc[0];
    } else if (state.filters.cc.length === state.uniqueCCs.filter(Boolean).length) {
        triggerText.textContent = 'Todos os C. Custos';
    } else {
        triggerText.textContent = `${state.filters.cc.length} selecionados`;
    }
}

function initCcMultiselect() {
    const trigger = document.getElementById('multiselect-cc-trigger');
    const container = document.getElementById('multiselect-cc-container');
    const searchInput = document.getElementById('multiselect-cc-search');
    
    if (!trigger || !container) return;
    
    // Toggle dropdown
    trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        container.classList.toggle('active');
        if (container.classList.contains('active') && searchInput) {
            searchInput.focus();
        }
    });
    
    // Stop propagation inside dropdown so clicks don't close it
    container.querySelector('.multiselect-dropdown').addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    // Close dropdown on click outside
    document.addEventListener('click', function() {
        container.classList.remove('active');
    });
    
    // Filter options on search
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const val = this.value.toLowerCase().trim();
            const options = container.querySelectorAll('.multiselect-option');
            options.forEach(opt => {
                const text = opt.dataset.value.toLowerCase();
                if (text.includes(val)) {
                    opt.style.display = 'flex';
                } else {
                    opt.style.display = 'none';
                }
            });
        });
    }
}

// Fill Sidebar Filter Dropdowns dynamically
function populateFilterSelects() {
    const fillSelect = (selectId, options) => {
        const select = document.getElementById(selectId);
        select.innerHTML = select.options[0].outerHTML;
        options.forEach(opt => {
            if (!opt) return;
            const el = document.createElement('option');
            el.value = opt;
            el.textContent = opt;
            select.appendChild(el);
        });
    };

    fillSelect('filter-tema', state.masterThemes);
    fillSelect('filter-regional', state.uniqueRegionals);
    fillSelect('filter-gerente', state.uniqueManagers);
    fillSelect('filter-empresa', state.uniqueCompanies);
    populateCcMultiselect(); // Draw checkboxes dynamically
    fillSelect('filter-frente', state.uniqueFrentes);

    // Compliance tab specific filters
    const compTemaSelect = document.getElementById('compliance-filter-tema-pendente');
    compTemaSelect.innerHTML = compTemaSelect.options[0].outerHTML;
    state.masterThemes.forEach(opt => {
        const el = document.createElement('option');
        el.value = opt;
        el.textContent = opt;
        compTemaSelect.appendChild(el);
    });
}

// Helper to determine if a collaborator matches the current global filters (demographics)
function isCollabMatchingFilters(collab, query = '') {
    if (state.filters.regional && collab.regional !== state.filters.regional) return false;
    if (state.filters.gerente && collab.gerente !== state.filters.gerente) return false;
    if (state.filters.tipo && collab.tipo !== state.filters.tipo) return false;
    if (state.filters.empresa && collab.empresa !== state.filters.empresa) return false;
    if (state.filters.cc && state.filters.cc.length > 0 && !state.filters.cc.includes(collab.cc)) return false;
    if (state.filters.frente && collab.frente !== state.filters.frente) return false;

    const s = (query || state.filters.search || '').toLowerCase().trim();
    if (s) {
        const matchesName = (collab.nome || '').toLowerCase().includes(s);
        const matchesMatricula = (collab.matricula || '').toLowerCase().includes(s);
        const matchesCC = (collab.cc || '').toLowerCase().includes(s);
        const matchesFuncao = (collab.funcao || '').toLowerCase().includes(s);
        if (!matchesName && !matchesMatricula && !matchesCC && !matchesFuncao) return false;
    }
    return true;
}

// Helper to determine if a raw record matches the current global filters (including theme filter if active)
function isRecordMatchingFilters(row, query = '') {
    if (state.filters.tema && row.tema !== state.filters.tema) return false;
    if (state.filters.regional && row.regional !== state.filters.regional) return false;
    if (state.filters.gerente && row.gerente !== state.filters.gerente) return false;
    if (state.filters.tipo && row.tipo !== state.filters.tipo) return false;
    if (state.filters.empresa && row.empresa !== state.filters.empresa) return false;
    if (state.filters.cc && state.filters.cc.length > 0 && !state.filters.cc.includes(row.cc)) return false;
    if (state.filters.frente && row.frente !== state.filters.frente) return false;

    const s = (query || state.filters.search || '').toLowerCase().trim();
    if (s) {
        const matchesName = (row.nome || '').toLowerCase().includes(s);
        const matchesMatricula = (row.matricula || '').toLowerCase().includes(s);
        const matchesCC = (row.cc || '').toLowerCase().includes(s);
        const matchesTema = (row.tema || '').toLowerCase().includes(s);
        if (!matchesName && !matchesMatricula && !matchesCC && !matchesTema) return false;
    }
    return true;
}

// Core filter function applied to the entire dataset
function applyFilters() {
    // 1. Filter Raw Submissions
    state.databaseTable.filteredData = state.rawRecords.filter(row => isRecordMatchingFilters(row));

    // 2. Filter Collaborators compliance lists
    const collabsList = Object.values(state.collaborators);
    state.complianceTable.filteredData = collabsList.filter(collab => {
        // Compliance Tab specific filters (Situation: Compliant vs Pending)
        const situationFilter = document.getElementById('compliance-filter-status').value;
        const themeFocus = state.filters.tema || document.getElementById('compliance-filter-tema-pendente').value;
        
        let completed = false;
        let pendingCount = collab.pendingCount;
        if (themeFocus) {
            completed = !!(collab.completedThemes && collab.completedThemes[themeFocus]);
            pendingCount = completed ? 0 : 1;
        }

        if (situationFilter === 'pending' && pendingCount === 0) return false;
        if (situationFilter === 'compliant' && pendingCount > 0) return false;

        // Specific theme pendency filter: shows only employees who have NOT completed this specific theme
        const pendingTemaFilter = document.getElementById('compliance-filter-tema-pendente').value;
        if (pendingTemaFilter && collab.completedThemes && collab.completedThemes[pendingTemaFilter]) return false;

        return isCollabMatchingFilters(collab);
    });

    // Reset pagination to first page after filters change
    state.complianceTable.currentPage = 1;
    state.databaseTable.currentPage = 1;

    // Trigger UI updates
    updateDashboardKPIs();
    renderCharts();
    renderComplianceTable();
    renderDatabaseTable();
}

// Calculations and updates for Top Overview KPIs
function updateDashboardKPIs() {
    const activeData = state.databaseTable.filteredData;
    const activeCollabs = Object.values(state.collaborators).filter(collab => isCollabMatchingFilters(collab));

    document.getElementById('kpi-total-participations').textContent = activeData.length.toLocaleString('pt-BR');
    document.getElementById('kpi-unique-employees').textContent = activeCollabs.length.toLocaleString('pt-BR');

    let avgScore = 0;
    if (activeData.length > 0) {
        const sum = activeData.reduce((acc, row) => acc + row.score, 0);
        avgScore = sum / activeData.length;
    }
    document.getElementById('kpi-average-score').textContent = avgScore.toFixed(1) + '/10';

    let complianceSum = 0;
    if (activeCollabs.length > 0) {
        if (state.filters.tema) {
            const completedCount = activeCollabs.filter(collab => collab.completedThemes && collab.completedThemes[state.filters.tema]).length;
            complianceSum = (completedCount / activeCollabs.length) * 100;
        } else {
            complianceSum = activeCollabs.reduce((acc, collab) => acc + collab.complianceRate, 0) / activeCollabs.length;
        }
    }
    document.getElementById('kpi-compliance-rate').textContent = complianceSum.toFixed(1) + '%';
    document.getElementById('kpi-total-themes').textContent = state.masterThemes.length;
}

// Chart.js visualizations renderer
function renderCharts() {
    const data = state.databaseTable.filteredData;

    const destroyChart = (chartKey) => {
        if (state.charts[chartKey]) {
            state.charts[chartKey].destroy();
            state.charts[chartKey] = null;
        }
    };

    const isDarkMode = document.body.classList.contains('dark-mode');
    const textCol = isDarkMode ? '#94a3b8' : '#64748b';
    const gridCol = isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    // Compute cohort filtered only by global/sidebar filters, not by compliance-tab-specific filters.
    // This is used for compliance-by-role and compliance-by-theme charts.
    const collabsList = Object.values(state.collaborators);
    const globalFilteredCollabs = collabsList.filter(collab => isCollabMatchingFilters(collab));
    // --- CHART 3: HISTÓRICO DE ENVIOS MENSAL ---
    destroyChart('history');
    const monthlyCounts = {};
    data.forEach(row => {
        let monthKey = 'Outro';
        const parts = row.timestamp.split(' ')[0].split('/');
        if (parts.length === 3) {
            monthKey = `${parts[1]}/${parts[2]}`;
        } else {
            const isoParts = row.timestamp.split(' ')[0].split('-');
            if (isoParts.length === 3) {
                monthKey = `${isoParts[1]}/${isoParts[0]}`;
            }
        }
        monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + 1;
    });
    
    const sortedMonths = Object.keys(monthlyCounts).sort((a,b) => {
        const ap = a.split('/');
        const bp = b.split('/');
        if (ap.length !== 2 || bp.length !== 2) return 0;
        const dateA = new Date(ap[1], ap[0] - 1);
        const dateB = new Date(bp[1], bp[0] - 1);
        return dateA - dateB;
    });

    const monthlyValues = sortedMonths.map(m => monthlyCounts[m]);

    state.charts.history = new Chart(document.getElementById('chart-history'), {
        type: 'line',
        data: {
            labels: sortedMonths,
            datasets: [{
                label: 'Participações',
                data: monthlyValues,
                backgroundColor: 'rgba(0, 168, 89, 0.1)',
                borderColor: '#00a859',
                borderWidth: 3,
                tension: 0.35,
                fill: true,
                pointBackgroundColor: '#00a859',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textCol }, grid: { display: false } },
                y: { ticks: { color: textCol }, grid: { color: gridCol } }
            }
        }
    });

    // --- CHART 4: TOP 10 CENTROS DE CUSTO ---
    destroyChart('empresas'); // Replaced top companies with Top CC since dashboard is limited to CGB SUL
    const ccCounts = {};
    data.forEach(row => {
        ccCounts[row.cc] = (ccCounts[row.cc] || 0) + 1;
    });
    const sortedCCs = Object.keys(ccCounts).sort((a, b) => ccCounts[b] - a).slice(0, 10);
    const ccValues = sortedCCs.map(c => ccCounts[c]);

    state.charts.empresas = new Chart(document.getElementById('chart-empresas'), {
        type: 'bar',
        data: {
            labels: sortedCCs,
            datasets: [{
                label: 'Participações',
                data: ccValues,
                backgroundColor: 'rgba(255, 128, 0, 0.75)',
                borderColor: '#ff8000',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textCol }, grid: { color: gridCol } },
                y: { ticks: { color: textCol }, grid: { display: false } }
            }
        }
    });

    // --- CHART 5: CONCLUSÃO DE TEMAS POR CENTRO DE CUSTO (Stacked Bar) ---
    destroyChart('gerentes');
    const ccStats = {};
    globalFilteredCollabs.forEach(collab => {
        const cc = collab.cc || 'NÃO MAPEADO';
        if (!ccStats[cc]) {
            ccStats[cc] = { realizados: 0, pendentes: 0 };
        }
        if (state.filters.tema) {
            const completed = !!(collab.completedThemes && collab.completedThemes[state.filters.tema]);
            if (completed) {
                ccStats[cc].realizados += 1;
            } else {
                ccStats[cc].pendentes += 1;
            }
        } else {
            ccStats[cc].realizados += collab.submissionsCount || 0;
            ccStats[cc].pendentes += collab.pendingCount || 0;
        }
    });

    const sortedCCCompliance = Object.keys(ccStats).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    state.charts.gerentes = new Chart(document.getElementById('chart-gerentes'), {
        type: 'bar',
        data: {
            labels: sortedCCCompliance,
            datasets: [
                {
                    label: 'Realizados',
                    data: sortedCCCompliance.map(cc => ccStats[cc].realizados),
                    backgroundColor: 'rgba(0, 168, 89, 0.75)', // Equatorial Green
                    borderColor: '#00a859',
                    borderWidth: 1
                },
                {
                    label: 'Pendentes',
                    data: sortedCCCompliance.map(cc => ccStats[cc].pendentes),
                    backgroundColor: 'rgba(239, 68, 68, 0.75)', // Red
                    borderColor: '#ef4444',
                    borderWidth: 1
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: textCol, boxWidth: 12, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const datasetLabel = context.dataset.label || '';
                            const value = context.raw || 0;
                            const cc = context.label;
                            const total = ccStats[cc].realizados + ccStats[cc].pendentes;
                            const pct = total > 0 ? (value / total) * 100 : 0;
                            return `${datasetLabel}: ${value} (${pct.toFixed(1)}%)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: textCol },
                    grid: { color: gridCol }
                },
                y: {
                    stacked: true,
                    ticks: { color: textCol },
                    grid: { display: false }
                }
            }
        }
    });

    // --- CHART 6: ADERÊNCIA POR TIPO DE FUNÇÃO (Horizontal Bar) ---
    destroyChart('funcoes');
    
    // Group active filtered collaborators by job role (funcao) and calculate average compliance
    const roleStats = {};
    globalFilteredCollabs.forEach(collab => {
        const role = collab.funcao || 'NÃO MAPEADA';
        if (!roleStats[role]) {
            roleStats[role] = { sum: 0, count: 0 };
        }
        const comp = state.filters.tema 
            ? (collab.completedThemes && collab.completedThemes[state.filters.tema] ? 100 : 0)
            : collab.complianceRate;
        roleStats[role].sum += comp;
        roleStats[role].count += 1;
    });

    const roleLabels = Object.keys(roleStats);
    const roleAverages = roleLabels.map(role => {
        const stats = roleStats[role];
        return {
            role: role,
            avg: stats.count > 0 ? stats.sum / stats.count : 0,
            count: stats.count
        };
    });

    // Sort roles by compliance rate descending
    roleAverages.sort((a, b) => b.avg - a.avg);

    const chartRoleLabels = roleAverages.map(item => item.role);
    const chartRoleValues = roleAverages.map(item => item.avg);

    state.charts.funcoes = new Chart(document.getElementById('chart-funcoes'), {
        type: 'bar',
        data: {
            labels: chartRoleLabels,
            datasets: [{
                label: 'Aderência (%)',
                data: chartRoleValues,
                backgroundColor: 'rgba(168, 85, 247, 0.75)', // Elegant Purple
                borderColor: '#a855f7',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const index = context.dataIndex;
                            const item = roleAverages[index];
                            return `Aderência: ${context.raw.toFixed(1)}% (${item.count} colab.)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    min: 0,
                    max: 100,
                    ticks: {
                        color: textCol,
                        callback: function(value) { return value + '%'; }
                    },
                    grid: { color: gridCol }
                },
                y: {
                    ticks: {
                        color: textCol,
                        font: { size: 10 }
                    },
                    grid: { display: false }
                }
            }
        }
    });

    // --- CHART 7: ADERÊNCIA POR TEMA DE DSC (Horizontal Bar) ---
    destroyChart('temas');

    const totalCohortSize = globalFilteredCollabs.length;
    const themeComplianceList = OFFICIAL_THEMES.map(theme => {
        let completedCount = 0;
        globalFilteredCollabs.forEach(collab => {
            if (collab.completedThemes && collab.completedThemes[theme]) {
                completedCount++;
            }
        });
        const pct = totalCohortSize > 0 ? (completedCount / totalCohortSize) * 100 : 0;
        return {
            theme: theme,
            percentage: pct,
            completedCount: completedCount
        };
    });

    // Sort themes by compliance percentage descending
    themeComplianceList.sort((a, b) => b.percentage - a.percentage);

    const chartThemeLabels = themeComplianceList.map(item => item.theme);
    const chartThemeValues = themeComplianceList.map(item => item.percentage);

    state.charts.temas = new Chart(document.getElementById('chart-temas'), {
        type: 'bar',
        data: {
            labels: chartThemeLabels,
            datasets: [{
                label: 'Aderência (%)',
                data: chartThemeValues,
                backgroundColor: 'rgba(20, 184, 166, 0.75)', // Elegant Teal
                borderColor: '#14b8a6',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const index = context.dataIndex;
                            const item = themeComplianceList[index];
                            return `Aderência: ${context.raw.toFixed(1)}% (${item.completedCount} de ${totalCohortSize} colab.)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    min: 0,
                    max: 100,
                    ticks: {
                        color: textCol,
                        callback: function(value) { return value + '%'; }
                    },
                    grid: { color: gridCol }
                },
                y: {
                    ticks: {
                        color: textCol,
                        font: { size: 10 }
                    },
                    grid: { display: false }
                }
            }
        }
    });
}

// Renders the main Compliance and Pending modules table
function renderComplianceTable() {
    const tableBody = document.getElementById('compliance-table-body');
    const filteredCollabs = state.complianceTable.filteredData;
    
    const themeFocus = state.filters.tema || document.getElementById('compliance-filter-tema-pendente').value;
    
    // Create a mapped array for rendering/sorting
    const mappedCollabs = filteredCollabs.map(collab => {
        if (themeFocus) {
            const completed = !!(collab.completedThemes && collab.completedThemes[themeFocus]);
            return {
                ...collab,
                displayComplianceRate: completed ? 100 : 0,
                displayPendingCount: completed ? 0 : 1,
                displaySubmissionsCount: completed ? 1 : 0
            };
        } else {
            return {
                ...collab,
                displayComplianceRate: collab.complianceRate,
                displayPendingCount: collab.pendingCount,
                displaySubmissionsCount: collab.submissionsCount
            };
        }
    });

    // Sort collabs by compliance rate ascending (lowest compliance first to highlight critical pending employees)
    mappedCollabs.sort((a,b) => a.displayComplianceRate - b.displayComplianceRate);

    // Calculate totals for metadata tags
    const pendingTotal = mappedCollabs.filter(c => c.displayPendingCount > 0).length;
    const compliantTotal = mappedCollabs.filter(c => c.displayPendingCount === 0).length;
    document.getElementById('compliance-pending-count').textContent = pendingTotal;
    document.getElementById('compliance-completed-count').textContent = compliantTotal;

    if (mappedCollabs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="11" class="loading-td">Nenhum colaborador encontrado com os filtros selecionados.</td></tr>`;
        document.getElementById('compliance-pagination-info').textContent = 'Mostrando 0 de 0 colaboradores';
        return;
    }

    // Pagination bounds
    const page = state.complianceTable.currentPage;
    const size = state.complianceTable.pageSize;
    const totalItems = mappedCollabs.length;
    const totalPages = Math.ceil(totalItems / size);
    
    if (page > totalPages) state.complianceTable.currentPage = totalPages;
    const startIndex = (state.complianceTable.currentPage - 1) * size;
    const endIndex = Math.min(startIndex + size, totalItems);
    
    const paginatedItems = mappedCollabs.slice(startIndex, endIndex);

    tableBody.innerHTML = '';
    paginatedItems.forEach(collab => {
        const tr = document.createElement('tr');
        
        let fillClass = 'low';
        if (collab.displayComplianceRate >= 75) fillClass = 'high';
        else if (collab.displayComplianceRate >= 40) fillClass = 'medium';

        // Render with new CC and Job Role columns
        tr.innerHTML = `
            <td><strong>${collab.nome}</strong></td>
            <td><code>${collab.matricula}</code></td>
            <td>${collab.regional}</td>
            <td>${collab.gerente}</td>
            <td>${collab.empresa}</td>
            <td><code style="color:var(--eq-orange); font-weight:700">${collab.cc}</code></td>
            <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis" title="${collab.funcao}">${collab.funcao}</td>
            <td class="center font-secondary"><strong>${collab.displaySubmissionsCount}</strong></td>
            <td class="center font-secondary">${collab.displayPendingCount}</td>
            <td>
                <div class="progress-bar-cell">
                    <span class="percent-val">${collab.displayComplianceRate.toFixed(0)}%</span>
                    <div class="bar-bg">
                        <div class="bar-fill ${fillClass}" style="width: ${collab.displayComplianceRate}%"></div>
                    </div>
                </div>
            </td>
            <td class="center">
                <button class="btn btn-secondary btn-icon-only btn-details" data-matricula="${collab.matricula}" title="Visualizar Detalhes">
                    <i class="fa-solid fa-folder-open"></i>
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });

    document.getElementById('compliance-current-page').textContent = state.complianceTable.currentPage;
    document.getElementById('compliance-pagination-info').textContent = `Mostrando ${startIndex + 1}-${endIndex} de ${totalItems} colaboradores`;

    document.querySelectorAll('.btn-details').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const mat = this.getAttribute('data-matricula');
            openEmployeeDrawer(mat);
        });
    });
}

// Renders the raw records database table
function renderDatabaseTable() {
    const tableBody = document.getElementById('database-table-body');
    const filteredRecords = state.databaseTable.filteredData;

    if (filteredRecords.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="10" class="loading-td">Nenhum registro encontrado.</td></tr>`;
        document.getElementById('database-pagination-info').textContent = 'Mostrando 0 de 0 registros';
        return;
    }

    const page = state.databaseTable.currentPage;
    const size = state.databaseTable.pageSize;
    const totalItems = filteredRecords.length;
    const totalPages = Math.ceil(totalItems / size);

    if (page > totalPages) state.databaseTable.currentPage = totalPages;
    const startIndex = (state.databaseTable.currentPage - 1) * size;
    const endIndex = Math.min(startIndex + size, totalItems);

    const paginatedItems = filteredRecords.slice(startIndex, endIndex);

    tableBody.innerHTML = '';
    paginatedItems.forEach(row => {
        const tr = document.createElement('tr');
        
        let scoreBadgeClass = 'score-low';
        if (row.score === 10) scoreBadgeClass = 'score-10';
        else if (row.score >= 7) scoreBadgeClass = 'completed';

        tr.innerHTML = `
            <td><code>${row.timestamp}</code></td>
            <td><code>${row.matricula}</code></td>
            <td><strong>${row.nome}</strong></td>
            <td>${row.regional}</td>
            <td>${row.gerente}</td>
            <td>${row.empresa}</td>
            <td><code>${row.cc}</code></td>
            <td>${row.funcao}</td>
            <td>${row.tema}</td>
            <td class="center"><span class="badge ${scoreBadgeClass}">${row.score}/10</span></td>
        `;
        tableBody.appendChild(tr);
    });

    document.getElementById('database-current-page').textContent = state.databaseTable.currentPage;
    document.getElementById('database-pagination-info').textContent = `Mostrando ${startIndex + 1}-${endIndex} de ${totalItems} registros`;
}

// Individual Employee Lookup renderer
function selectEmployee(matricula) {
    const emp = state.collaborators[matricula];
    if (!emp) return;

    state.selectedEmployeeMatricula = matricula;
    document.getElementById('employee-detail-placeholder').classList.add('hidden');
    
    const card = document.getElementById('employee-detail-card');
    card.classList.remove('hidden');

    document.getElementById('emp-detail-name').textContent = emp.nome;
    document.getElementById('emp-detail-matricula').textContent = emp.matricula;
    document.getElementById('emp-detail-cidade').textContent = emp.cidade;
    document.getElementById('emp-detail-regional').textContent = emp.regional;
    document.getElementById('emp-detail-empresa').textContent = emp.empresa;
    
    // Set CUBOS values
    document.getElementById('emp-detail-vinculo').textContent = emp.tipo;
    document.getElementById('emp-detail-funcao').textContent = emp.funcao;
    document.getElementById('emp-detail-cc').textContent = emp.cc;
    
    document.getElementById('emp-detail-frente').textContent = emp.frente;
    document.getElementById('emp-detail-gerente').textContent = emp.gerente;
    document.getElementById('emp-detail-ultimo-envio').textContent = emp.lastActive;
    document.getElementById('emp-detail-nota-media').textContent = emp.averageScore.toFixed(1) + '/10';
    
    document.getElementById('emp-detail-concluidos-count').textContent = emp.submissionsCount;
    document.getElementById('emp-detail-pendentes-count').textContent = emp.pendingCount;

    // Set Radial Progress Ring
    const percentageText = document.getElementById('emp-detail-percentage');
    percentageText.textContent = emp.complianceRate.toFixed(0) + '%';
    
    const circle = document.getElementById('emp-progress-ring-value');
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    
    const offset = circumference - (emp.complianceRate / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    
    if (emp.complianceRate >= 75) circle.style.stroke = '#10b981';
    else if (emp.complianceRate >= 45) circle.style.stroke = '#f59e0b';
    else circle.style.stroke = '#ef4444';

    document.getElementById('chk-total').textContent = state.masterThemes.length;
    document.getElementById('chk-concluidos').textContent = emp.submissionsCount;
    document.getElementById('chk-pendentes').textContent = emp.pendingCount;

    renderChecklistFilter('all');
}

// Renders the checklist inside the individual lookup pane
function renderChecklistFilter(filterType) {
    const wrapper = document.getElementById('emp-modules-checklist');
    const emp = state.collaborators[state.selectedEmployeeMatricula];
    if (!emp) return;

    wrapper.innerHTML = '';
    
    state.masterThemes.forEach(theme => {
        const completed = emp.completedThemes[theme];
        
        if (filterType === 'completed' && !completed) return;
        if (filterType === 'pending' && completed) return;

        const div = document.createElement('div');
        div.className = `checklist-item ${completed ? 'completed' : 'pending'}`;
        
        const icon = completed ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-clock"></i>';
        
        let metaHtml = '';
        if (completed) {
            let scoreBadgeClass = 'score-low';
            if (completed.score === 10) scoreBadgeClass = 'score-10';
            else if (completed.score >= 7) scoreBadgeClass = 'completed';

            metaHtml = `
                <div class="checklist-item-meta">
                    <span class="date"><i class="fa-regular fa-calendar"></i> ${completed.date.split(' ')[0]}</span>
                    <span class="badge ${scoreBadgeClass}">${completed.score}/10</span>
                </div>
            `;
        } else {
            metaHtml = `
                <div class="checklist-item-meta">
                    <span class="badge pending">Não respondido</span>
                </div>
            `;
        }

        div.innerHTML = `
            <div class="checklist-status-icon">${icon}</div>
            <div class="checklist-item-title">${theme}</div>
            ${metaHtml}
        `;
        wrapper.appendChild(div);
    });
}

// Side Drawer Detail Sheet for Table Lists
function openEmployeeDrawer(matricula) {
    const emp = state.collaborators[matricula];
    if (!emp) return;

    const drawerOverlay = document.getElementById('employee-drawer');
    const drawerContent = document.getElementById('drawer-body-content');
    
    let progressColor = '#10b981';
    if (emp.complianceRate < 45) progressColor = '#ef4444';
    else if (emp.complianceRate < 75) progressColor = '#f59e0b';

    let checklistHtml = '';
    state.masterThemes.forEach(theme => {
        const done = emp.completedThemes[theme];
        checklistHtml += `
            <div class="checklist-item ${done ? 'completed' : 'pending'}" style="padding: 10px 14px; margin-bottom: 6px; font-size:12px;">
                <div class="checklist-status-icon" style="width: 20px; height: 20px; font-size:9px; margin-right:12px;">
                    ${done ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-clock"></i>'}
                </div>
                <div class="checklist-item-title" style="font-size:12px">${theme}</div>
                <div>
                    ${done 
                        ? `<span class="badge ${done.score === 10 ? 'score-10' : done.score >= 7 ? 'completed' : 'score-low'}" style="font-size:10px; padding: 2px 6px;">Nota ${done.score}</span>`
                        : `<span class="badge pending" style="font-size:10px; padding: 2px 6px;">Pendente</span>`
                    }
                </div>
            </div>
        `;
    });

    drawerContent.innerHTML = `
        <div style="display:flex; flex-direction:column; gap: 20px;">
            <div class="glass" style="padding: 16px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h3 style="margin-bottom:6px; border:none; padding:0">${emp.nome}</h3>
                    <div style="font-size:12px; color:var(--text-muted); display:flex; flex-direction:column; gap:4px">
                        <span><strong>Matrícula:</strong> ${emp.matricula}</span>
                        <span><strong>Centro de Custo:</strong> <code style="color:var(--eq-orange); font-weight:700">${emp.cc}</code></span>
                        <span><strong>Função:</strong> ${emp.funcao} (${emp.situacao})</span>
                        <span><strong>Seção:</strong> ${emp.secao}</span>
                        <span><strong>Gerente:</strong> ${emp.gerente}</span>
                    </div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:24px; font-weight:800; color:${progressColor}">${emp.complianceRate.toFixed(0)}%</div>
                    <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:700">Conclusão</div>
                </div>
            </div>

            <button id="drawer-btn-full-profile" class="btn btn-primary btn-block" data-matricula="${emp.matricula}">
                <i class="fa-solid fa-user-check"></i> Abrir Painel Completo do Colaborador
            </button>

            <div>
                <h4 style="font-family:var(--font-secondary); margin-bottom:12px; font-size:13px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px">Lacunas e Conformidade</h4>
                <div class="modules-checklist-wrapper" style="max-height: 380px;">
                    ${checklistHtml}
                </div>
            </div>
        </div>
    `;

    drawerOverlay.classList.remove('hidden');

    document.getElementById('drawer-btn-full-profile').addEventListener('click', function() {
        const mat = this.getAttribute('data-matricula');
        drawerOverlay.classList.add('hidden');
        document.querySelector('.nav-item[data-tab="tab-colaborador"]').click();
        document.getElementById('employee-detail-search-input').value = mat;
        selectEmployee(mat);
    });
}

// Exports data to CSV and triggers file download
function downloadCSV(filename, csvContent) {
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    if (navigator.msSaveBlob) {
        navigator.msSaveBlob(blob, filename);
    } else {
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }
}

// Generates a compliance gap report of all employees for Excel/CSV export
function exportComplianceReport() {
    const list = state.complianceTable.filteredData;
    if (list.length === 0) {
        showToast('Nenhum dado de conformidade para exportar.', 'danger');
        return;
    }

    let csv = 'Nome Completo,Matrícula,Regional,Gerente,Empresa,Centro de Custo,Função,Vínculo,Concluídos,Pendentes,Percentual de Conformidade,Módulos Pendentes\n';
    
    list.forEach(c => {
        const name = `"${c.nome.replace(/"/g, '""')}"`;
        const mat = `"${c.matricula.replace(/"/g, '""')}"`;
        const reg = `"${c.regional.replace(/"/g, '""')}"`;
        const mgr = `"${c.gerente.replace(/"/g, '""')}"`;
        const comp = `"${c.empresa.replace(/"/g, '""')}"`;
        const cc = `"${c.cc.replace(/"/g, '""')}"`;
        const func = `"${c.funcao.replace(/"/g, '""')}"`;
        const type = `"${c.tipo.replace(/"/g, '""')}"`;
        const pendingModulesStr = `"${c.pendingThemes.join('; ').replace(/"/g, '""')}"`;
        
        csv += `${name},${mat},${reg},${mgr},${comp},${cc},${func},${type},${c.submissionsCount},${c.pendingCount},${c.complianceRate.toFixed(1)}%,${pendingModulesStr}\n`;
    });

    downloadCSV('relatorio_pendencias_dsc_cgb.csv', csv);
    showToast('Relatório de pendências exportado com sucesso!', 'success');
}

// Exports filtered raw database records to CSV
function exportDatabaseReport() {
    const list = state.databaseTable.filteredData;
    if (list.length === 0) {
        showToast('Nenhum dado filtrado para exportar.', 'danger');
        return;
    }

    let csv = 'Carimbo de data/hora,Pontuação,Tema do DSC,Nome Completo,Matrícula,Cidade,Tipo de Vínculo,Empresa,Regional,Centro de Custo,Função,Gerente,Frente de Atuação\n';
    
    list.forEach(r => {
        const timestamp = `"${r.timestamp}"`;
        const score = `"${r.score}"`;
        const tema = `"${r.tema.replace(/"/g, '""')}"`;
        const name = `"${r.nome.replace(/"/g, '""')}"`;
        const mat = `"${r.matricula.replace(/"/g, '""')}"`;
        const cidade = `"${r.cidade.replace(/"/g, '""')}"`;
        const tipo = `"${r.tipo.replace(/"/g, '""')}"`;
        const comp = `"${r.empresa.replace(/"/g, '""')}"`;
        const reg = `"${r.regional.replace(/"/g, '""')}"`;
        const cc = `"${r.cc}"`;
        const func = `"${r.funcao.replace(/"/g, '""')}"`;
        const mgr = `"${r.gerente.replace(/"/g, '""')}"`;
        const frente = `"${r.frente.replace(/"/g, '""')}"`;
        
        csv += `${timestamp},${score},${tema},${name},${mat},${cidade},${tipo},${comp},${reg},${cc},${func},${mgr},${frente}\n`;
    });

    downloadCSV('base_filtrada_dsc_cgb.csv', csv);
    showToast('Base de dados filtrada exportada!', 'success');
}

// Processes the CSV string using PapaParse
function processCsvData(csvText) {
    return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            error: function(err) {
                reject(err);
            },
            complete: function(results) {
                resolve(results.data);
            }
        });
    });
}

// Renders and updates dashboard when records are set
function initializeDashboard(records, rebuildMatrix = true) {
    if (rebuildMatrix) {
        state.rawRecords = normalizeData(records);
        buildCollaboratorComplianceMatrix();
    }
    populateFilterSelects();
    
    state.complianceTable.filteredData = Object.values(state.collaborators);
    state.databaseTable.filteredData = state.rawRecords;
    
    document.getElementById('import-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    
    const statusText = document.getElementById('db-status-text');
    statusText.innerHTML = `CGB SUL: ${state.rawRecords.length.toLocaleString('pt-BR')} registros`;
    document.getElementById('db-status-badge').querySelector('.status-dot').className = 'status-dot green';

    clearAllFilters(false);
    applyFilters();
    
    showToast('Base de dados CGB Regional Sul inicializada!', 'success');
}

function clearAllFilters(reApply = true) {
    state.filters = {
        search: '',
        tema: '',
        regional: '',
        gerente: '',
        tipo: '',
        empresa: '',
        cc: [],
        frente: ''
    };
    
    document.getElementById('filter-search-name').value = '';
    document.getElementById('filter-tema').value = '';
    document.getElementById('filter-regional').value = '';
    document.getElementById('filter-gerente').value = '';
    document.getElementById('filter-tipo').value = '';
    document.getElementById('filter-empresa').value = '';
    document.getElementById('filter-frente').value = '';
    
    // Reset custom multiselect UI state
    document.querySelectorAll('#multiselect-cc-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    const msSearch = document.getElementById('multiselect-cc-search');
    if (msSearch) msSearch.value = '';
    document.querySelectorAll('#multiselect-cc-options .multiselect-option').forEach(opt => opt.style.display = 'flex');
    updateCcMultiselectTriggerText();

    if (reApply) {
        applyFilters();
    }
}

// Client-Side parsing of CUBOS xlsx file structure
function parseSheetJSRows(rows) {
    if (rows.length === 0) return {};
    
    // Normalize headers: uppercase, trim and remove non-alphanumeric chars to avoid encoding replacement character issues
    const headers = rows[0].map(h => {
        let str = String(h || '').trim().toUpperCase();
        return str.replace(/[^A-Z0-9]/g, ''); // removes replacement chars like 
    });
    
    let chapaIdx = headers.findIndex(h => h.includes('CHAPA'));
    let nomeIdx = headers.findIndex(h => h.includes('NOME'));
    let ccIdx = headers.findIndex(h => h.includes('RATEIO') || h.includes('CC'));
    let secaoIdx = headers.findIndex(h => h.includes('SEO') || h.includes('SECA') || h.includes('SEC'));
    let funcaoIdx = headers.findIndex(h => h.includes('FUN') || h.includes('CARGO'));
    let situacaoIdx = headers.findIndex(h => h.includes('SITU'));
    
    // Fallbacks if headers not detected
    if (chapaIdx === -1) chapaIdx = 0;
    if (nomeIdx === -1) nomeIdx = 1;
    if (ccIdx === -1) ccIdx = headers.length > 3 ? 3 : 2;
    if (funcaoIdx === -1) funcaoIdx = headers.length > 4 ? 4 : 3;
    if (situacaoIdx === -1) situacaoIdx = headers.length > 2 ? 2 : 1;
    // secaoIdx is allowed to remain -1 if missing (e.g. CUBOS_Atualizado)

    const mapping = {};
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length === 0) continue;
        
        let chapaVal = String(r[chapaIdx] || '').trim();
        if (!chapaVal || chapaVal === 'None' || chapaVal === 'undefined') continue;
        
        let chapaNormalized = chapaVal;
        if (!isNaN(parseFloat(chapaVal))) {
            chapaNormalized = String(Math.floor(parseFloat(chapaVal)));
        } else {
            chapaNormalized = chapaVal.toLowerCase();
        }
        
        const cc = ccIdx !== -1 ? (String(r[ccIdx] || '').trim() || 'NÃO MAPEADO') : 'NÃO MAPEADO';
        const secao = secaoIdx !== -1 ? (String(r[secaoIdx] || '').trim() || 'NÃO MAPEADA') : 'NÃO MAPEADA';
        const funcao = funcaoIdx !== -1 ? (String(r[funcaoIdx] || '').trim() || 'NÃO MAPEADA') : 'NÃO MAPEADA';
        const situacao = situacaoIdx !== -1 ? (String(r[situacaoIdx] || '').trim() || 'ATIVO') : 'ATIVO';
        
        mapping[chapaNormalized] = {
            nome: String(r[nomeIdx] || '').trim().toUpperCase(),
            cc: cc,
            secao: secao,
            funcao: funcao,
            situacao: situacao
        };
    }
    return mapping;
}

// Triggers Excel/CSV loading from drag and drop file object
function loadFileObject(file) {
    const loadingDiv = document.getElementById('import-loading');
    const loadingText = document.getElementById('import-loading-text');
    const progressBar = document.getElementById('import-progress');
    
    loadingDiv.classList.remove('hidden');
    progressBar.style.width = "20%";

    if (file.name.endsWith('.xlsx')) {
        loadingText.textContent = "Processando planilha CUBOS Excel...";
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                const cubosParsed = parseSheetJSRows(jsonRows);
                progressBar.style.width = "70%";
                
                saveToDB(cubosParsed, 'cubos_dataset')
                    .then(() => {
                        state.cubosData = cubosParsed;
                        progressBar.style.width = "100%";
                        showToast(`Encontrados ${Object.keys(cubosParsed).length} registros em CUBOS!`, 'success');
                        
                        // If we already have CSV records, re-initialize join using raw records from local storage
                        return loadFromDB('current_dataset');
                    })
                    .then(rawRecords => {
                        if (rawRecords && rawRecords.length > 0) {
                            initializeDashboard(rawRecords);
                        } else {
                            loadingDiv.classList.add('hidden');
                            loadingText.textContent = "";
                        }
                    });
            } catch (err) {
                console.error(err);
                loadingDiv.classList.add('hidden');
                showToast('Erro ao ler planilha Excel.', 'danger');
            }
        };
        reader.readAsArrayBuffer(file);
    } 
    else if (file.name.endsWith('.csv')) {
        loadingText.textContent = "Processando respostas DSC...";
        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            processCsvData(text)
                .then(records => {
                    progressBar.style.width = "80%";
                    return saveToDB(records, 'current_dataset').then(() => records);
                })
                .then(records => {
                    progressBar.style.width = "100%";
                    setTimeout(() => {
                        initializeDashboard(records);
                    }, 200);
                })
                .catch(err => {
                    console.error(err);
                    loadingDiv.classList.add('hidden');
                    showToast('Erro ao processar CSV de respostas.', 'danger');
                });
        };
        reader.readAsText(file, 'UTF-8');
    } else {
        loadingDiv.classList.add('hidden');
        showToast('Tipo de arquivo não suportado. Use CSV ou XLSX.', 'danger');
    }
}

// DOM Setup and Core UI Listeners
document.addEventListener('DOMContentLoaded', () => {
    
    // --- Navigation Tabs Switch ---
    document.querySelectorAll('.nav-tabs .nav-item').forEach(item => {
        item.addEventListener('click', function() {
            document.querySelectorAll('.nav-tabs .nav-item').forEach(i => i.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            this.classList.add('active');
            const targetPane = document.getElementById(this.getAttribute('data-tab'));
            targetPane.classList.add('active');
            
            if (this.getAttribute('data-tab') === 'tab-visao-geral') {
                renderCharts();
            }

            document.getElementById('app-container').classList.remove('sidebar-active');
            document.querySelector('.sidebar').classList.remove('active');
        });
    });

    // --- Global Sidebar Filters ---
    const updateGlobalFilter = (key, value) => {
        state.filters[key] = value;
        applyFilters();
    };

    document.getElementById('filter-search-name').addEventListener('input', function() {
        updateGlobalFilter('search', this.value.trim());
    });
    document.getElementById('filter-tema').addEventListener('change', function() {
        updateGlobalFilter('tema', this.value);
    });
    document.getElementById('filter-regional').addEventListener('change', function() {
        updateGlobalFilter('regional', this.value);
    });
    document.getElementById('filter-gerente').addEventListener('change', function() {
        updateGlobalFilter('gerente', this.value);
    });
    document.getElementById('filter-tipo').addEventListener('change', function() {
        updateGlobalFilter('tipo', this.value);
    });
    document.getElementById('filter-empresa').addEventListener('change', function() {
        updateGlobalFilter('empresa', this.value);
    });
    initCcMultiselect(); // Initialize custom cost center multiselect dropdown behaviors
    document.getElementById('filter-frente').addEventListener('change', function() {
        updateGlobalFilter('frente', this.value);
    });

    document.getElementById('btn-clear-filters').addEventListener('click', () => {
        clearAllFilters(true);
        showToast('Filtros redefinidos.', 'info');
    });

    // --- Compliance Tab Filters ---
    document.getElementById('compliance-filter-status').addEventListener('change', applyFilters);
    document.getElementById('compliance-filter-tema-pendente').addEventListener('change', applyFilters);
    
    document.getElementById('compliance-table-search').addEventListener('input', function() {
        const query = this.value.toLowerCase().trim();
        const collabsList = Object.values(state.collaborators);
        
        state.complianceTable.filteredData = collabsList.filter(collab => {
            const situationFilter = document.getElementById('compliance-filter-status').value;
            const themeFocus = state.filters.tema || document.getElementById('compliance-filter-tema-pendente').value;
            
            let completed = false;
            let pendingCount = collab.pendingCount;
            if (themeFocus) {
                completed = !!(collab.completedThemes && collab.completedThemes[themeFocus]);
                pendingCount = completed ? 0 : 1;
            }

            if (situationFilter === 'pending' && pendingCount === 0) return false;
            if (situationFilter === 'compliant' && pendingCount > 0) return false;

            const pendingTemaFilter = document.getElementById('compliance-filter-tema-pendente').value;
            if (pendingTemaFilter && collab.completedThemes && collab.completedThemes[pendingTemaFilter]) return false;

            return isCollabMatchingFilters(collab, query);
        });

        state.complianceTable.currentPage = 1;
        renderComplianceTable();
    });

    // --- Compliance Pagination ---
    document.getElementById('compliance-prev-page').addEventListener('click', () => {
        if (state.complianceTable.currentPage > 1) {
            state.complianceTable.currentPage--;
            renderComplianceTable();
        }
    });
    document.getElementById('compliance-next-page').addEventListener('click', () => {
        const maxPage = Math.ceil(state.complianceTable.filteredData.length / state.complianceTable.pageSize);
        if (state.complianceTable.currentPage < maxPage) {
            state.complianceTable.currentPage++;
            renderComplianceTable();
        }
    });

    // --- Database Table search & Pagination ---
    document.getElementById('database-table-search').addEventListener('input', function() {
        const query = this.value.toLowerCase().trim();
        state.databaseTable.filteredData = state.rawRecords.filter(row => isRecordMatchingFilters(row, query));

        state.databaseTable.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById('database-prev-page').addEventListener('click', () => {
        if (state.databaseTable.currentPage > 1) {
            state.databaseTable.currentPage--;
            renderDatabaseTable();
        }
    });
    document.getElementById('database-next-page').addEventListener('click', () => {
        const maxPage = Math.ceil(state.databaseTable.filteredData.length / state.databaseTable.pageSize);
        if (state.databaseTable.currentPage < maxPage) {
            state.databaseTable.currentPage++;
            renderDatabaseTable();
        }
    });

    // --- Exporters ---
    document.getElementById('btn-export-compliance').addEventListener('click', exportComplianceReport);
    document.getElementById('btn-export-database').addEventListener('click', exportDatabaseReport);

    // --- Reupload CSV Handler ---
    document.getElementById('btn-reupload-csv').addEventListener('click', () => {
        document.getElementById('app-container').classList.add('hidden');
        document.getElementById('import-screen').classList.remove('hidden');
        document.getElementById('import-loading').classList.add('hidden');
    });

    // --- Drag and Drop File Actions ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('csv-file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            Array.from(this.files).forEach(file => loadFileObject(file));
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            Array.from(e.dataTransfer.files).forEach(file => loadFileObject(file));
        }
    });

    // --- Theme Switcher ---
    document.getElementById('theme-toggle-btn').addEventListener('click', function() {
        const body = document.body;
        const icon = this.querySelector('i');
        
        if (body.classList.contains('dark-mode')) {
            body.classList.remove('dark-mode');
            icon.className = 'fa-solid fa-moon';
            showToast('Tema claro ativado', 'info');
        } else {
            body.classList.add('dark-mode');
            icon.className = 'fa-solid fa-sun';
            showToast('Tema escuro ativado', 'info');
        }
        renderCharts();
    });

    // --- Close Slide Drawer Overlay ---
    document.getElementById('btn-close-drawer').addEventListener('click', () => {
        document.getElementById('employee-drawer').classList.add('hidden');
    });
    
    document.getElementById('employee-drawer').addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.add('hidden');
        }
    });

    // --- Mobile Layout Handlers ---
    document.getElementById('mobile-toggle-sidebar').addEventListener('click', () => {
        document.querySelector('.sidebar').classList.add('active');
        document.getElementById('app-container').classList.add('sidebar-active');
    });

    document.getElementById('mobile-close-sidebar').addEventListener('click', () => {
        document.querySelector('.sidebar').classList.remove('active');
        document.getElementById('app-container').classList.remove('sidebar-active');
    });

    // --- Individual Employee Search & Autocomplete ---
    const empSearchInput = document.getElementById('employee-detail-search-input');
    const suggestionsBox = document.getElementById('search-suggestions');

    empSearchInput.addEventListener('input', function() {
        const val = this.value.trim().toLowerCase();
        if (val.length < 2) {
            suggestionsBox.innerHTML = '';
            suggestionsBox.classList.add('hidden');
            return;
        }

        const matches = Object.values(state.collaborators).filter(col => {
            return col.nome.toLowerCase().includes(val) || 
                   col.matricula.includes(val) || 
                   (col.cc || '').toLowerCase().includes(val);
        }).slice(0, 8);

        if (matches.length === 0) {
            suggestionsBox.innerHTML = '<div class="suggestion-item" style="cursor:default; color:var(--text-muted)">Nenhum colaborador encontrado</div>';
            suggestionsBox.classList.remove('hidden');
            return;
        }

        suggestionsBox.innerHTML = '';
        matches.forEach(m => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerHTML = `
                <div>
                    <strong>${m.nome}</strong>
                    <div style="font-size:10px; color:var(--text-muted); margin-top:2px">C. Custo: ${m.cc} • Gerente: ${m.gerente}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px">
                    <span class="regional">${m.regional}</span>
                    <span class="matricula">${m.matricula}</span>
                </div>
            `;
            div.addEventListener('click', () => {
                empSearchInput.value = m.matricula;
                suggestionsBox.innerHTML = '';
                suggestionsBox.classList.add('hidden');
                selectEmployee(m.matricula);
            });
            suggestionsBox.appendChild(div);
        });
        suggestionsBox.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!empSearchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.innerHTML = '';
            suggestionsBox.classList.add('hidden');
        }
    });

    document.getElementById('btn-search-employee').addEventListener('click', () => {
        const val = empSearchInput.value.trim();
        if (state.collaborators[val]) {
            selectEmployee(val);
        } else {
            const matchByName = Object.values(state.collaborators).find(c => c.nome.toUpperCase() === val.toUpperCase());
            if (matchByName) {
                selectEmployee(matchByName.matricula);
            } else {
                showToast('Digite uma matrícula válida ou selecione um colaborador.', 'danger');
            }
        }
    });

    // Checklist chips filter inside individual card
    document.getElementById('chk-btn-all').addEventListener('click', function() {
        document.querySelectorAll('.checklist-filters button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        renderChecklistFilter('all');
    });
    document.getElementById('chk-btn-completed').addEventListener('click', function() {
        document.querySelectorAll('.checklist-filters button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        renderChecklistFilter('completed');
    });
    document.getElementById('chk-btn-pending').addEventListener('click', function() {
        document.querySelectorAll('.checklist-filters button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        renderChecklistFilter('pending');
    });

    // --- Google Sheets Sync Logic (Real-time) ---
    const googleSheetUrl = 'https://docs.google.com/spreadsheets/d/1MEty2mXjENUqL7LYC5XBSJxKA_mklqmn1ZbvmEz9wtk/export?format=csv&gid=222033020';

    function syncWithGoogleSheets(showSpinner = false) {
        const syncBtn = document.getElementById('btn-sync-sheets');
        const icon = syncBtn.querySelector('i');
        
        // Spin icon
        icon.classList.add('fa-spin');
        
        const loadingDiv = document.getElementById('import-loading');
        const loadingText = document.getElementById('import-loading-text');
        const progressBar = document.getElementById('import-progress');
        
        if (showSpinner) {
            document.getElementById('import-screen').classList.remove('hidden');
            loadingDiv.classList.remove('hidden');
            loadingText.textContent = "Sincronizando dados com Google Sheets...";
            progressBar.style.width = "40%";
        } else {
            showToast('Conectando ao Google Sheets...', 'info');
        }

        return fetch(googleSheetUrl + '&_cb=' + Date.now(), {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        })
            .then(res => {
                if (!res.ok) throw new Error('Falha HTTP ao carregar planilha Google');
                return res.text();
            })
            .then(csvText => {
                if (showSpinner) {
                    loadingText.textContent = "Processando planilha Google...";
                    progressBar.style.width = "75%";
                }
                return processCsvData(csvText);
            })
            .then(records => {
                if (showSpinner) {
                    progressBar.style.width = "100%";
                }
                return saveToDB(records, 'current_dataset').then(() => {
                    initializeDashboard(records);
                    
                    // Show Sync state on Navbar Badge
                    const statusText = document.getElementById('db-status-text');
                    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    statusText.innerHTML = `Live • CGB SUL (${state.rawRecords.length.toLocaleString('pt-BR')} reg) • Sinc às ${now}`;
                    
                    showToast('Planilha Google atualizada com sucesso!', 'success');
                });
            })
            .catch(err => {
                console.warn("Erro ao puxar dados do Google Sheets:", err);
                showToast('Não foi possível sincronizar com o Google Sheets online.', 'danger');
                if (showSpinner) {
                    loadingDiv.classList.add('hidden');
                }
                return Promise.reject(err); // Propagate to trigger offline fallback
            })
            .finally(() => {
                icon.classList.remove('fa-spin');
            });
    }

    // Bind sync button click
    document.getElementById('btn-sync-sheets').addEventListener('click', () => {
        syncWithGoogleSheets(false);
    });

    // --- MAIN INITIALIZATION FLOW ---
    
    // Step 1: Load CUBOS cost center mapping (Always try to fetch latest online, fallback to IndexedDB)
    console.log("Tentando obter cadastro CUBOS atualizado...");
    const loadCubosPromise = fetch('cadastro_cubos.json')
        .then(r => {
            if (!r.ok) throw new Error('cadastro_cubos.json not found');
            return r.json();
        })
        .then(jsonData => {
            console.log("CUBOS registry loaded from server:", Object.keys(jsonData).length);
            state.cubosData = jsonData;
            return saveToDB(jsonData, 'cubos_dataset');
        })
        .catch(err => {
            console.log("Auto-fetch CUBOS failed. Fallback to IndexedDB local cache:", err.message);
            return loadFromDB('cubos_dataset')
                .then(savedCubos => {
                    if (savedCubos && Object.keys(savedCubos).length > 0) {
                        console.log("CUBOS data loaded from IndexedDB local cache:", Object.keys(savedCubos).length);
                        state.cubosData = savedCubos;
                    } else {
                        console.log("No CUBOS cache found. Join will default to 'NÃO MAPEADO'.");
                    }
                });
        });

    loadCubosPromise
        .then(() => {
            // Step 2: Try to load DSC training dataset directly from Google Sheets (Real-Time Sync)
            console.log("Tentando obter dados em tempo real da Planilha Google...");
            return syncWithGoogleSheets(true)
                .catch(err => {
                    // Step 3: Fallback to IndexedDB offline cache
                    console.log("Fallback 1: Carregando dados salvos no IndexedDB...");
                    return loadFromDB('current_dataset')
                        .then(savedData => {
                            if (savedData && savedData.length > 0) {
                                initializeDashboard(savedData);
                                
                                // Update badge showing Offline state
                                const statusText = document.getElementById('db-status-text');
                                statusText.innerHTML = `Offline • CGB SUL (${state.rawRecords.length.toLocaleString('pt-BR')} registros)`;
                                showToast('Carregado da memória local (modo offline).', 'info');
                            } else {
                                // Step 4: Fallback to local files dados.csv
                                console.log("Fallback 2: Carregando dados.csv da raiz...");
                                return fetch('dados.csv')
                                    .then(response => {
                                        if (!response.ok) throw new Error('dados.csv não encontrado.');
                                        return response.text();
                                    })
                                    .then(csvText => {
                                        return processCsvData(csvText);
                                    })
                                    .then(records => {
                                        return saveToDB(records, 'current_dataset').then(() => records);
                                    })
                                    .then(records => {
                                        initializeDashboard(records);
                                    });
                            }
                        });
                });
        })
        .catch(err => {
            console.error("Erro na inicialização geral:", err);
            // Hide loading, show file input drag-drop as final resort
            document.getElementById('import-loading').classList.add('hidden');
            document.getElementById('drop-zone').classList.remove('hidden');
        });
});
