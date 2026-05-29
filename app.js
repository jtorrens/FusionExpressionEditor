const state = {
  fileHandle: null,
  fileName: "",
  originalText: "",
  roots: [],
  activeRootId: null,
  header: null,
  tools: [],
  expressions: [],
  selectedId: null,
  filteredIds: [],
  expandedTools: new Set(),
  activeTab: "header",
  replaceMode: false,
  replaceSelectedIds: new Set(),
};

let expressionEditorView = null;
let fallbackExpressionTextarea = null;
let fallbackOpenInput = null;
let editorUpdateLocked = false;

const els = {
  structureBar: document.querySelector("#structureBar"),
  structureResizer: document.querySelector("#structureResizer"),
  structureSummary: document.querySelector("#structureSummary"),
  structureList: document.querySelector("#structureList"),
  headerTabBtn: document.querySelector("#headerTabBtn"),
  toolsTabBtn: document.querySelector("#toolsTabBtn"),
  headerView: document.querySelector("#headerView"),
  toolsView: document.querySelector("#toolsView"),
  headerEmptyState: document.querySelector("#headerEmptyState"),
  headerState: document.querySelector("#headerState"),
  operatorTypeSelect: document.querySelector("#operatorTypeSelect"),
  headerInputs: document.querySelector("#headerInputs"),
  headerOutputs: document.querySelector("#headerOutputs"),
  openPickerBtn: document.querySelector("#openPickerBtn"),
  pasteBtn: document.querySelector("#pasteBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  copyBtn: document.querySelector("#copyBtn"),
  fileStatus: document.querySelector("#fileStatus"),
  searchInput: document.querySelector("#searchInput"),
  counter: document.querySelector("#counter"),
  replaceModeBtn: document.querySelector("#replaceModeBtn"),
  replacePanel: document.querySelector("#replacePanel"),
  replaceFindInput: document.querySelector("#replaceFindInput"),
  replaceWithInput: document.querySelector("#replaceWithInput"),
  selectVisibleBtn: document.querySelector("#selectVisibleBtn"),
  clearSelectionBtn: document.querySelector("#clearSelectionBtn"),
  applyReplaceBtn: document.querySelector("#applyReplaceBtn"),
  expressionList: document.querySelector("#expressionList"),
  emptyState: document.querySelector("#emptyState"),
  editorState: document.querySelector("#editorState"),
  toolName: document.querySelector("#toolName"),
  inputName: document.querySelector("#inputName"),
  dirtyBadge: document.querySelector("#dirtyBadge"),
  expressionEditor: document.querySelector("#expressionEditor"),
  originalExpressionViewer: document.querySelector("#originalExpressionViewer"),
  lineInfo: document.querySelector("#lineInfo"),
  revertBtn: document.querySelector("#revertBtn"),
};

els.headerTabBtn.addEventListener("click", () => switchTab("header"));
els.toolsTabBtn.addEventListener("click", () => switchTab("tools"));
els.operatorTypeSelect.addEventListener("change", updateOperatorType);
els.openPickerBtn.addEventListener("click", openWithPicker);
els.pasteBtn.addEventListener("click", openFromClipboard);
els.saveBtn.addEventListener("click", saveFile);
els.downloadBtn.addEventListener("click", downloadFile);
els.copyBtn.addEventListener("click", copyFileToClipboard);
els.searchInput.addEventListener("input", renderList);
els.replaceModeBtn.addEventListener("click", toggleReplaceMode);
els.replaceFindInput.addEventListener("input", renderList);
els.selectVisibleBtn.addEventListener("click", selectVisibleForReplace);
els.clearSelectionBtn.addEventListener("click", clearReplaceSelection);
els.applyReplaceBtn.addEventListener("click", applyReplace);
els.revertBtn.addEventListener("click", revertSelectedExpression);

setupStructureResizer();
setupExpressionEditor();

window.addEventListener("error", (event) => {
  els.fileStatus.textContent = `Script error: ${event.message}`;
});

window.addEventListener("unhandledrejection", (event) => {
  els.fileStatus.textContent = `Script error: ${event.reason?.message ?? event.reason}`;
});

function setupStructureResizer() {
  const savedWidth = Number(localStorage.getItem("structurePanelWidth"));
  if (savedWidth) {
    setStructurePanelWidth(savedWidth);
  }

  let dragging = false;

  const stopDragging = (event) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing-structure");
    if (els.structureResizer.hasPointerCapture(event.pointerId)) {
      els.structureResizer.releasePointerCapture(event.pointerId);
    }
    localStorage.setItem("structurePanelWidth", String(currentStructurePanelWidth()));
  };

  els.structureResizer.addEventListener("pointerdown", (event) => {
    dragging = true;
    document.body.classList.add("resizing-structure");
    els.structureResizer.setPointerCapture(event.pointerId);
  });

  els.structureResizer.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    setStructurePanelWidth(event.clientX);
  });

  els.structureResizer.addEventListener("pointerup", stopDragging);
  els.structureResizer.addEventListener("pointercancel", stopDragging);
}

function setStructurePanelWidth(width) {
  const clamped = Math.max(160, Math.min(420, width));
  document.documentElement.style.setProperty("--structure-width", `${clamped}px`);
}

function currentStructurePanelWidth() {
  return els.structureBar.getBoundingClientRect().width;
}

async function openWithPicker(event) {
  if (event?.shiftKey && "showOpenFilePicker" in window) {
    await openWithWritablePicker();
    return;
  }

  openWithFileInputFallback();
}

async function openWithWritablePicker() {
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "Fusion settings",
          accept: { "text/plain": [".setting", ".comp", ".txt"] },
        },
      ],
    });

    const file = await handle.getFile();
    state.fileHandle = handle;
    await loadDocumentText(await file.text(), file.name);
  } catch (error) {
    if (isProtectedFileSystemError(error)) {
      els.fileStatus.textContent = "Chrome blocked direct file access for that location. Opening as read-only instead.";
      openWithFileInputFallback();
      return;
    }

    if (error.name !== "AbortError") {
      els.fileStatus.textContent = `Could not open file: ${error.message}`;
    }
  }
}

function openWithFileInputFallback() {
  if (!fallbackOpenInput) {
    fallbackOpenInput = document.createElement("input");
    fallbackOpenInput.type = "file";
    fallbackOpenInput.accept = ".setting,.comp,.txt";
    fallbackOpenInput.hidden = true;
    fallbackOpenInput.addEventListener("change", async () => {
      const [file] = fallbackOpenInput.files;
      if (!file) return;

      state.fileHandle = null;
      await loadDocumentText(await file.text(), file.name);
      fallbackOpenInput.value = "";
    });
    document.body.append(fallbackOpenInput);
  }

  fallbackOpenInput.click();
}

async function openFromClipboard() {
  try {
    if (!navigator.clipboard?.readText) {
      openManualPasteDialog();
      return;
    }

    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      els.fileStatus.textContent = "Clipboard is empty.";
      return;
    }

    state.fileHandle = null;
    await loadDocumentText(text, "clipboard.setting");
  } catch (error) {
    openManualPasteDialog(error.message);
  }
}

function openManualPasteDialog(reason = "") {
  const existing = document.querySelector(".manual-paste");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "manual-paste";
  overlay.innerHTML = `
    <div class="manual-paste-dialog">
      <div class="manual-paste-head">
        <strong>Paste setting text</strong>
        <button type="button" data-action="close">Close</button>
      </div>
      ${reason ? `<p>${escapeHtml(reason)}</p>` : ""}
      <textarea spellcheck="false" placeholder="Paste Fusion .setting text here"></textarea>
      <div class="manual-paste-actions">
        <button type="button" data-action="load">Load text</button>
      </div>
    </div>
  `;

  const textarea = overlay.querySelector("textarea");
  overlay.querySelector("[data-action='close']").addEventListener("click", () => overlay.remove());
  overlay.querySelector("[data-action='load']").addEventListener("click", async () => {
    const text = textarea.value;
    if (!text.trim()) {
      els.fileStatus.textContent = "Paste text before loading.";
      return;
    }

    state.fileHandle = null;
    await loadDocumentText(text, "clipboard.setting");
    overlay.remove();
  });

  document.body.append(overlay);
  textarea.focus();
}

async function loadDocumentText(text, fileName) {
  const documentData = parseFusionDocument(text);

  state.fileName = fileName;
  state.originalText = text;
  state.roots = documentData.roots;
  state.tools = documentData.tools;
  state.expressions = documentData.expressions;
  state.activeRootId = state.roots[0]?.id ?? null;
  syncActiveRoot();
  state.selectedId = toolExpressions()[0]?.id ?? null;
  state.expandedTools = new Set(activeTools().map((tool) => tool.name));
  state.activeTab = state.header ? "header" : "tools";
  state.replaceMode = false;
  state.replaceSelectedIds = new Set();

  els.searchInput.disabled = false;
  els.replaceModeBtn.disabled = false;
  els.saveBtn.disabled = false;
  els.downloadBtn.disabled = false;
  els.copyBtn.disabled = false;
  els.fileStatus.textContent = fileStatusText(fileName, state.header, activeTools().length, toolExpressions().length);

  renderStructure();
  renderTabs();
  renderReplacePanel();
  renderHeader();
  renderList();
  renderEditor();
}

function parseFusionDocument(text) {
  const tokens = tokenizeFusion(text);
  const stack = [];
  const roots = [];
  const tools = [];
  const toolsByKey = new Map();
  const expressions = [];
  let header = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.type === "{") {
      const context = contextFromOpeningBrace(tokens, i);
      const parentSection = lastStackItem(stack, "section");
      const parentRoot = lastRootItem(stack);

      if (context.kind === "header" && !parentRoot) {
        const root = {
          id: roots.length,
          name: context.name,
          toolType: context.toolType,
          kind: "container",
          line: lineAt(text, token.start),
          header: null,
          sourceOps: [],
        };
        const headerData = {
          rootId: root.id,
          name: context.name,
          operatorType: context.toolType,
          originalOperatorType: context.toolType,
          typeStart: context.typeStart,
          typeEnd: context.typeEnd,
          inputs: [],
          outputs: [],
        };
        root.header = headerData;
        roots.push(root);
        context.rootId = root.id;
        context.header = headerData;
        header = header ?? headerData;
      } else if (context.kind === "tool") {
        if (!parentRoot) {
          const root = {
            id: roots.length,
            name: context.name,
            toolType: context.toolType,
            kind: "tool",
            line: lineAt(text, token.start),
            header: null,
            sourceOps: parseToolSourceOps(tokens, i),
          };
          roots.push(root);
          context.rootId = root.id;
        } else {
          context.rootId = parentRoot.rootId;
        }

        const toolKey = `${context.rootId}:${context.name}`;
        if (toolsByKey.has(toolKey)) {
          stack.push(context);
          continue;
        }

        const tool = {
          id: tools.length,
          rootId: context.rootId,
          name: context.name,
          toolType: context.toolType,
          line: lineAt(text, token.start),
          sourceOps: parseToolSourceOps(tokens, i),
        };
        tools.push(tool);
        toolsByKey.set(toolKey, tool);
      } else if (context.kind === "headerItem" && parentSection) {
        const ownerHeader = lastStackItem(stack, "header")?.header;
        const target = parentSection.name === "Inputs" ? ownerHeader?.inputs : ownerHeader?.outputs;
        target?.push(parseHeaderItem(text, tokens, i, context, parentSection.name));
      }

      stack.push(context);
      continue;
    }

    if (token.type === "}") {
      stack.pop();
      continue;
    }

    if (
      token.type === "id" &&
      token.value === "Expression" &&
      tokens[i + 1]?.type === "=" &&
      tokens[i + 2]?.type === "string"
    ) {
      const stringToken = tokens[i + 2];
      const tool = lastStackItem(stack, "tool");
      const input = lastStackItem(stack, "input");
      const decoded = decodeFusionString(stringToken.raw);

      expressions.push({
        id: expressions.length,
        rootId: tool?.rootId ?? "",
        toolId: tool?.name ?? "",
        toolName: tool?.name ?? "Tool desconocido",
        toolType: tool?.toolType ?? "",
        inputName: input?.name ?? "Input desconocido",
        start: stringToken.start,
        end: stringToken.end,
        original: decoded,
        current: decoded,
        line: lineAt(text, token.start),
      });
    }
  }

  return { roots, header, tools, expressions };
}

function parseFusionExpressions(text) {
  return parseFusionDocument(text).expressions;
}

function tokenizeFusion(text) {
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (isWhitespace(char)) {
      i += 1;
      continue;
    }

    if (char === "-" && text[i + 1] === "-") {
      i = skipLineComment(text, i + 2);
      continue;
    }

    if (char === "\"") {
      const token = readQuotedString(text, i);
      tokens.push(token);
      i = token.end;
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = i;
      i += 1;
      while (i < text.length && isIdentifierPart(text[i])) i += 1;
      tokens.push({ type: "id", value: text.slice(start, i), start, end: i });
      continue;
    }

    if (isNumberStart(text, i)) {
      const start = i;
      if (text[i] === "+" || text[i] === "-") i += 1;
      while (i < text.length && (isDigit(text[i]) || text[i] === ".")) i += 1;
      tokens.push({ type: "number", value: text.slice(start, i), start, end: i });
      continue;
    }

    if ("{}=(),".includes(char)) {
      tokens.push({ type: char, value: char, start: i, end: i + 1 });
    }

    i += 1;
  }

  return tokens;
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function isIdentifierStart(char) {
  const code = char.charCodeAt(0);
  return char === "_" || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isIdentifierPart(char) {
  return isIdentifierStart(char) || isDigit(char);
}

function isDigit(char) {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isNumberStart(text, index) {
  const char = text[index];
  if (isDigit(char)) return true;
  if ((char === "+" || char === "-") && index + 1 < text.length) {
    return isDigit(text[index + 1]);
  }
  return false;
}

function readQuotedString(text, start) {
  let i = start + 1;
  let escaped = false;

  while (i < text.length) {
    const char = text[i];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "\"") {
      i += 1;
      break;
    }
    i += 1;
  }

  return {
    type: "string",
    value: text.slice(start, i),
    raw: text.slice(start + 1, i - 1),
    start,
    end: i,
  };
}

function skipLineComment(text, i) {
  while (i < text.length && text[i] !== "\n") i += 1;
  return i;
}

function contextFromOpeningBrace(tokens, braceIndex) {
  const section = sectionContextFromOpeningBrace(tokens, braceIndex);
  if (section) return section;

  const prev = previousSignificant(tokens, braceIndex - 1);
  const beforePrev = previousSignificant(tokens, prev.index - 1);
  const nameToken = previousSignificant(tokens, beforePrev.index - 1);

  if (prev.token?.type === "id" && beforePrev.token?.type === "=" && nameToken.token?.type === "id") {
    if (["InstanceInput", "InstanceOutput"].includes(prev.token.value)) {
      return {
        kind: "headerItem",
        name: nameToken.token.value,
        itemType: prev.token.value,
      };
    }

    if (prev.token.value === "Input") {
      return { kind: "input", name: nameToken.token.value };
    }

    if (["MacroOperator", "GroupOperator"].includes(prev.token.value)) {
      return {
        kind: "header",
        name: nameToken.token.value,
        toolType: prev.token.value,
        typeStart: prev.token.start,
        typeEnd: prev.token.end,
      };
    }

    if (!["FuID", "OperatorInfo", "GroupInfo"].includes(prev.token.value)) {
      return { kind: "tool", name: nameToken.token.value, toolType: prev.token.value };
    }
  }

  if (prev.token?.type === "id" && isStandaloneToolType(prev.token.value)) {
    return { kind: "tool", name: prev.token.value, toolType: prev.token.value };
  }

  return { kind: "generic" };
}

function isStandaloneToolType(value) {
  return value && ![
    "Input",
    "InstanceInput",
    "InstanceOutput",
    "FuID",
    "OperatorInfo",
    "GroupInfo",
    "ordered",
  ].includes(value);
}

function sectionContextFromOpeningBrace(tokens, braceIndex) {
  const prev = previousSignificant(tokens, braceIndex - 1);
  const beforePrev = previousSignificant(tokens, prev.index - 1);
  const beforeBeforePrev = previousSignificant(tokens, beforePrev.index - 1);
  const equalToken = previousSignificant(tokens, beforeBeforePrev.index - 1);
  const nameToken = previousSignificant(tokens, equalToken.index - 1);

  if (
    prev.token?.type === ")" &&
    beforePrev.token?.type === "(" &&
    beforeBeforePrev.token?.type === "id" &&
    beforeBeforePrev.token.value === "ordered" &&
    equalToken.token?.type === "=" &&
    nameToken.token?.type === "id"
  ) {
    return { kind: "section", name: nameToken.token.value };
  }

  const directPrev = previousSignificant(tokens, braceIndex - 1);
  const directBeforePrev = previousSignificant(tokens, directPrev.index - 1);
  if (directPrev.token?.type === "=" && directBeforePrev.token?.type === "id") {
    return { kind: "section", name: directBeforePrev.token.value };
  }

  return null;
}

function parseHeaderItem(text, tokens, braceIndex, context, sectionName) {
  const endIndex = findMatchingBraceToken(tokens, braceIndex);
  const fields = [];
  let depth = 0;

  for (let i = braceIndex + 1; i < endIndex; i += 1) {
    if (tokens[i].type === "{") {
      depth += 1;
      continue;
    }

    if (tokens[i].type === "}") {
      depth -= 1;
      continue;
    }

    if (
      depth === 0 &&
      tokens[i]?.type === "id" &&
      tokens[i + 1]?.type === "=" &&
      isHeaderFieldValueToken(tokens[i + 2])
    ) {
      const valueToken = tokens[i + 2];
      const valueEndIndex = valueToken.type === "{" ? findMatchingBraceToken(tokens, i + 2) : i + 2;
      const valueEnd = tokens[valueEndIndex].end;
      fields.push({
        key: tokens[i].value,
        raw: valueToken.value,
        value: fieldDisplayValue(text, valueToken, valueEnd),
        current: fieldDisplayValue(text, valueToken, valueEnd),
        editable: tokens[i].value === "Name" && valueToken.type === "string",
        valueStart: valueToken.start,
        valueEnd,
      });

      if (valueToken.type === "{") {
        i = valueEndIndex;
      }
    }
  }

  return {
    section: sectionName,
    key: context.name,
    itemType: context.itemType,
    fields,
  };
}

function parseToolSourceOps(tokens, braceIndex) {
  const endIndex = findMatchingBraceToken(tokens, braceIndex);
  const sourceOps = new Set();
  let depth = 0;

  for (let i = braceIndex + 1; i < endIndex; i += 1) {
    if (
      tokens[i]?.type === "id" &&
      tokens[i].value === "SourceOp" &&
      tokens[i + 1]?.type === "=" &&
      tokens[i + 2]?.type === "string"
    ) {
      sourceOps.add(decodeFusionString(tokens[i + 2].raw));
    }

    if (tokens[i].type === "{") depth += 1;
    if (tokens[i].type === "}") depth -= 1;
  }

  return [...sourceOps];
}

function findMatchingBraceToken(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].type === "{") depth += 1;
    if (tokens[i].type === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

function isHeaderFieldValueToken(token) {
  return token && ["id", "string", "number", "{"].includes(token.type);
}

function fieldDisplayValue(text, token, valueEnd) {
  if (token.type === "string") return decodeFusionString(token.raw);
  if (token.type === "{") return text.slice(token.start, valueEnd).replace(/\s+/g, " ").trim();
  return token.value;
}

function previousSignificant(tokens, fromIndex) {
  for (let i = fromIndex; i >= 0; i -= 1) {
    if (tokens[i]) return { token: tokens[i], index: i };
  }
  return { token: null, index: -1 };
}

function lastRootItem(stack) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].rootId !== undefined && stack[i].rootId !== null) return stack[i];
  }
  return null;
}

function lastStackItem(stack, kind) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].kind === kind) return stack[i];
  }
  return null;
}

function decodeFusionString(raw) {
  return raw.replace(/\\(n|r|t|"|\\)/g, (_, code) => {
    const values = { n: "\n", r: "\r", t: "\t", "\"": "\"", "\\": "\\" };
    return values[code] ?? code;
  });
}

function encodeFusionString(value) {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function activeRoot() {
  return state.roots.find((root) => root.id === state.activeRootId) ?? null;
}

function syncActiveRoot() {
  const root = activeRoot();
  state.header = root?.header ?? null;
}

function activeTools() {
  return state.tools.filter((tool) => tool.rootId === state.activeRootId);
}

function renderStructure() {
  els.structureList.innerHTML = "";
  els.structureSummary.textContent = state.roots.length
    ? `${state.roots.length} root node${state.roots.length === 1 ? "" : "s"}`
    : "No nodes loaded";

  const tree = buildStructureTree();
  for (const root of tree.topRoots) {
    renderStructureNode(root, tree.childrenByParent, 0, new Set());
  }
}

function buildStructureTree() {
  const rootsByName = new Map(state.roots.map((root) => [root.name, root]));
  const childrenByParent = new Map();
  const rootsWithParents = new Set();

  for (const root of state.roots) {
    const parentNames = (root.sourceOps ?? []).filter((sourceOp) => rootsByName.has(sourceOp));
    for (const parentName of parentNames) {
      if (!childrenByParent.has(parentName)) {
        childrenByParent.set(parentName, []);
      }
      childrenByParent.get(parentName).push(root);
      rootsWithParents.add(root.name);
    }
  }

  const topRoots = state.roots.filter((root) => !rootsWithParents.has(root.name));
  return {
    childrenByParent,
    topRoots: topRoots.length ? topRoots : state.roots,
  };
}

function renderStructureNode(root, childrenByParent, level, path) {
  if (path.has(root.name)) return;

  const expressionCount = state.expressions.filter((item) => item.rootId === root.id).length;
  const button = document.createElement("button");
  button.type = "button";
  button.className = [
    "structure-item",
    root.id === state.activeRootId ? "active" : "",
    expressionCount > 0 ? "has-expressions" : "no-expressions",
  ].filter(Boolean).join(" ");
  button.style.setProperty("--tree-level", String(level));
  button.addEventListener("click", () => selectRoot(root.id));
  button.innerHTML = `
    <span class="structure-node-main">
      <strong>${escapeHtml(root.name)}</strong>
      <span class="structure-count">${expressionCount}</span>
    </span>
    <span class="structure-node-type">${escapeHtml(root.toolType)}</span>
  `;
  els.structureList.append(button);

  const nextPath = new Set(path);
  nextPath.add(root.name);
  for (const child of childrenByParent.get(root.name) ?? []) {
    renderStructureNode(child, childrenByParent, level + 1, nextPath);
  }
}

function selectRoot(rootId) {
  state.activeRootId = rootId;
  syncActiveRoot();
  state.activeTab = state.header ? "header" : "tools";
  state.selectedId = toolExpressions()[0]?.id ?? null;
  state.expandedTools = new Set(activeTools().map((tool) => tool.name));
  state.replaceSelectedIds.clear();
  els.fileStatus.textContent = fileStatusText(state.fileName, state.header, activeTools().length, toolExpressions().length);

  renderStructure();
  renderTabs();
  renderHeader();
  renderList();
  renderEditor();
}

function renderList() {
  const query = els.searchInput.value.trim().toLowerCase();
  const replaceFind = els.replaceFindInput.value;
  const expressionsByTool = toolExpressions();
  const visibleTools = activeTools()
    .map((tool) => {
      const expressions = expressionsByTool.filter((item) => item.toolId === tool.name);
      const toolMatches = `${tool.name} ${tool.toolType}`.toLowerCase().includes(query);
      const matchingExpressions = expressions.filter((item) => {
        const haystack = `${item.toolName} ${item.toolType} ${item.inputName} ${item.current}`.toLowerCase();
        return haystack.includes(query);
      });

      return {
        tool,
        expressions: (query && !toolMatches ? matchingExpressions : expressions)
          .filter((item) => !state.replaceMode || !replaceFind || item.current.includes(replaceFind)),
        visible: !query || toolMatches || matchingExpressions.length > 0,
      };
    })
    .filter((group) => group.visible && group.expressions.length > 0);

  state.filteredIds = visibleTools.flatMap((group) => group.expressions.map((item) => item.id));
  state.replaceSelectedIds = new Set([...state.replaceSelectedIds].filter((id) => {
    return toolExpressions().some((item) => item.id === id);
  }));
  els.counter.textContent = String(state.filteredIds.length);
  els.expressionList.innerHTML = "";

  for (const group of visibleTools) {
    const wrapper = document.createElement("div");
    wrapper.className = "tool-group";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "tool-header";
    header.setAttribute("aria-expanded", String(isToolExpanded(group.tool.name)));
    header.addEventListener("click", () => toggleTool(group.tool.name));

    const changedCount = group.expressions.filter(isChanged).length;
    header.innerHTML = `
      <span class="tree-arrow">${isToolExpanded(group.tool.name) ? "v" : ">"}</span>
      <span class="tool-title">
        <span class="tool-main">
          <strong>${escapeHtml(group.tool.name)}</strong>
          <span class="tool-count">${group.expressions.length}</span>
        </span>
        <span class="tool-meta">${escapeHtml(group.tool.toolType)}</span>
      </span>
      ${changedCount ? `<span class="tool-changed">${changedCount}</span>` : ""}
    `;
    wrapper.append(header);

    if (isToolExpanded(group.tool.name)) {
      const children = document.createElement("div");
      children.className = "tool-children";

      if (group.expressions.length === 0) {
        const empty = document.createElement("div");
        empty.className = "tool-empty";
        empty.textContent = "No expressions";
        children.append(empty);
      }

      for (const item of group.expressions) {
        children.append(createExpressionButton(item));
      }

      wrapper.append(children);
    }

    els.expressionList.append(wrapper);
  }
}

function switchTab(tabName) {
  if (tabName === "header" && !state.header) return;

  state.activeTab = tabName;
  if (tabName === "tools" && !selectedExpression()) {
    state.selectedId = toolExpressions()[0]?.id ?? null;
  }
  renderTabs();
  renderEditor();
}

function renderTabs() {
  if (!state.header && state.activeTab === "header") {
    state.activeTab = "tools";
  }

  const isHeader = state.activeTab === "header";
  els.headerTabBtn.disabled = !state.header;
  els.headerTabBtn.title = state.header ? "Header" : "No MacroOperator or GroupOperator header found";
  els.headerTabBtn.classList.toggle("active", isHeader);
  els.toolsTabBtn.classList.toggle("active", !isHeader);
  els.headerView.hidden = !isHeader;
  els.toolsView.hidden = isHeader;
}

function renderHeader() {
  const header = state.header;
  els.headerEmptyState.hidden = Boolean(header);
  els.headerState.hidden = !header;
  els.headerInputs.innerHTML = "";
  els.headerOutputs.innerHTML = "";

  if (!header) return;

  els.operatorTypeSelect.value = header.operatorType;
  renderHeaderItems(els.headerInputs, header.inputs);
  renderHeaderItems(els.headerOutputs, header.outputs);
}

function renderHeaderItems(container, items) {
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "header-item-empty";
    empty.textContent = "No items";
    container.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "header-item";

    const title = document.createElement("div");
    title.className = "header-item-title";
    title.innerHTML = `<strong>${escapeHtml(item.key)}</strong><span>${escapeHtml(item.itemType)}</span>`;
    card.append(title);

    const fields = document.createElement("div");
    fields.className = "header-fields";

    for (const field of item.fields) {
      const row = document.createElement("label");
      row.className = `header-field${field.editable ? " editable" : ""}`;

      const key = document.createElement("span");
      key.textContent = field.key;
      row.append(key);

      if (field.editable) {
        const input = document.createElement("input");
        input.type = "text";
        input.value = field.current;
        input.addEventListener("input", () => {
          field.current = input.value;
        });
        row.append(input);
      } else {
        const value = document.createElement("code");
        value.textContent = field.current;
        row.append(value);
      }

      fields.append(row);
    }

    card.append(fields);
    container.append(card);
  }
}

function updateOperatorType() {
  if (!state.header) return;
  state.header.operatorType = els.operatorTypeSelect.value;
}

function createExpressionButton(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `expr-item${item.id === state.selectedId ? " active" : ""}${isChanged(item) ? " changed" : ""}`;
  button.addEventListener("click", () => selectExpression(item.id));

  const title = document.createElement("div");
  title.className = "expr-title";
  title.innerHTML = `<span>${escapeHtml(item.inputName)}</span>${isChanged(item) ? "<span class=\"changed-dot\"></span>" : ""}`;

  if (state.replaceMode) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "replace-checkbox";
    checkbox.checked = state.replaceSelectedIds.has(item.id);
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => toggleReplaceSelection(item.id, checkbox.checked));
    title.prepend(checkbox);
  }

  const preview = document.createElement("div");
  preview.className = "expr-preview";
  preview.textContent = item.current.replace(/\s+/g, " ").trim();

  button.append(title, preview);
  return button;
}

function toggleReplaceMode() {
  state.replaceMode = !state.replaceMode;
  if (state.replaceMode) {
    state.replaceSelectedIds = new Set(state.filteredIds);
  } else {
    state.replaceSelectedIds.clear();
  }

  renderReplacePanel();
  renderList();
}

function renderReplacePanel() {
  els.replacePanel.hidden = !state.replaceMode;
  els.replaceModeBtn.classList.toggle("active", state.replaceMode);
  els.replaceModeBtn.textContent = state.replaceMode ? "Done" : "Replace";
}

function toggleReplaceSelection(id, checked) {
  if (checked) {
    state.replaceSelectedIds.add(id);
  } else {
    state.replaceSelectedIds.delete(id);
  }
}

function selectVisibleForReplace() {
  state.replaceSelectedIds = new Set(state.filteredIds);
  renderList();
}

function clearReplaceSelection() {
  state.replaceSelectedIds.clear();
  renderList();
}

function applyReplace() {
  const findText = els.replaceFindInput.value;
  if (!findText) {
    els.fileStatus.textContent = "Enter text to find before applying replace.";
    return;
  }

  let changedCount = 0;
  for (const item of toolExpressions()) {
    if (!state.replaceSelectedIds.has(item.id) || !item.current.includes(findText)) continue;

    item.current = item.current.split(findText).join(els.replaceWithInput.value);
    changedCount += 1;
  }

  els.fileStatus.textContent = `replaced · ${changedCount} expressions updated`;
  renderList();
  renderEditor();
}

function toggleTool(toolName) {
  if (state.expandedTools.has(toolName)) {
    state.expandedTools.delete(toolName);
  } else {
    state.expandedTools.add(toolName);
  }
  renderList();
}

function isToolExpanded(toolName) {
  return state.expandedTools.has(toolName);
}

function selectExpression(id) {
  state.selectedId = id;
  const item = selectedExpression();
  if (item?.toolId) {
    state.expandedTools.add(item.toolId);
  }
  renderList();
  renderEditor();
}

async function setupExpressionEditor() {
  try {
    const [
      stateModule,
      commandsModule,
      languageModule,
      viewModule,
      luaModule,
    ] = await Promise.all([
      import("https://esm.sh/@codemirror/state@6"),
      import("https://esm.sh/@codemirror/commands@6"),
      import("https://esm.sh/@codemirror/language@6"),
      import("https://esm.sh/@codemirror/view@6"),
      import("https://esm.sh/@codemirror/legacy-modes/mode/lua"),
    ]);

    const { EditorState } = stateModule;
    const { defaultKeymap, history, historyKeymap, indentWithTab } = commandsModule;
    const { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } = languageModule;
    const { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } = viewModule;
    const { lua } = luaModule;

    expressionEditorView = new EditorView({
      parent: els.expressionEditor,
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          StreamLanguage.define(lua),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || editorUpdateLocked) return;
            updateSelectedExpression(update.state.doc.toString());
          }),
        ],
      }),
    });
    renderEditor();
  } catch (error) {
    setupFallbackExpressionEditor();
    renderEditor();
    console.warn("CodeMirror unavailable; using plain text editor.", error);
  }
}

function setupFallbackExpressionEditor() {
  fallbackExpressionTextarea = document.createElement("textarea");
  fallbackExpressionTextarea.className = "plain-expression-editor";
  fallbackExpressionTextarea.spellcheck = false;
  fallbackExpressionTextarea.addEventListener("input", () => {
    if (editorUpdateLocked) return;
    updateSelectedExpression(fallbackExpressionTextarea.value);
  });
  fallbackExpressionTextarea.addEventListener("keydown", handleFallbackEditorKeydown);
  els.expressionEditor.replaceChildren(fallbackExpressionTextarea);
}

function setEditorValue(value) {
  editorUpdateLocked = true;

  if (expressionEditorView) {
    expressionEditorView.dispatch({
      changes: {
        from: 0,
        to: expressionEditorView.state.doc.length,
        insert: value,
      },
    });
  } else if (fallbackExpressionTextarea) {
    fallbackExpressionTextarea.value = value;
  }

  editorUpdateLocked = false;
}

function renderEditor() {
  const item = selectedExpression();
  els.emptyState.hidden = Boolean(item);
  els.editorState.hidden = !item;

  if (!item) return;

  els.toolName.textContent = `${item.toolName}${item.toolType ? ` · ${item.toolType}` : ""}`;
  els.inputName.textContent = item.inputName;
  setEditorValue(item.current);
  els.originalExpressionViewer.textContent = item.original;
  els.dirtyBadge.hidden = !isChanged(item);
  els.lineInfo.textContent = `Line ${item.line}`;
}

function updateSelectedExpression(value) {
  const item = selectedExpression();
  if (!item) return;

  item.current = value;
  els.dirtyBadge.hidden = !isChanged(item);
  renderList();
}

function revertSelectedExpression() {
  const item = selectedExpression();
  if (!item) return;

  item.current = item.original;
  renderList();
  renderEditor();
}

function selectedExpression() {
  return toolExpressions().find((item) => item.id === state.selectedId) ?? null;
}

function toolExpressions() {
  return state.expressions.filter((item) => {
    return item.rootId === state.activeRootId && item.toolId && item.toolName !== "Tool desconocido";
  });
}

function isChanged(item) {
  return item.current !== item.original;
}

function buildUpdatedText() {
  let text = state.originalText;
  const changed = [
    ...headerReplacements(),
    ...state.expressions
      .filter(isChanged)
      .map((item) => ({
        start: item.start,
        end: item.end,
        value: encodeFusionString(item.current),
      })),
  ].sort((a, b) => b.start - a.start);

  for (const replacement of changed) {
    text = text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end);
  }

  return text;
}

function headerReplacements() {
  const replacements = [];

  for (const root of state.roots) {
    const header = root.header;
    if (!header) continue;

    if (header.operatorType !== header.originalOperatorType) {
      replacements.push({
        start: header.typeStart,
        end: header.typeEnd,
        value: header.operatorType,
      });
    }

    for (const item of [...header.inputs, ...header.outputs]) {
      for (const field of item.fields) {
        if (field.editable && field.current !== field.value) {
          replacements.push({
            start: field.valueStart,
            end: field.valueEnd,
            value: encodeFusionString(field.current),
          });
        }
      }
    }
  }

  return replacements;
}

async function saveFile() {
  const updatedText = buildUpdatedText();

  if (!state.fileHandle || !("createWritable" in state.fileHandle)) {
    await downloadFile();
    return;
  }

  try {
    const writable = await state.fileHandle.createWritable();
    await writable.write(updatedText);
    await writable.close();
    markSaved(updatedText);
  } catch (error) {
    if (isProtectedFileSystemError(error)) {
      els.fileStatus.textContent = "Chrome blocked saving back to that protected location. Use Save As or Copy.";
      return;
    }

    els.fileStatus.textContent = `Could not save: ${error.message}`;
  }
}

async function downloadFile() {
  const updatedText = buildUpdatedText();
  const suggestedName = saveAsFileName();

  if (!("showSaveFilePicker" in window)) {
    downloadText(updatedText, suggestedName);
    return;
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: "Fusion settings",
          accept: { "text/plain": [".setting", ".comp", ".txt"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(updatedText);
    await writable.close();
    els.fileStatus.textContent = `saved as · ${suggestedName}`;
  } catch (error) {
    if (error.name !== "AbortError") {
      els.fileStatus.textContent = `Could not save as: ${error.message}`;
    }
  }
}

async function copyFileToClipboard() {
  try {
    await navigator.clipboard.writeText(buildUpdatedText());
    els.fileStatus.textContent = `copied · ${fileStatusText(state.fileName, state.header, activeTools().length, toolExpressions().length)}`;
  } catch (error) {
    els.fileStatus.textContent = `Could not copy: ${error.message}`;
  }
}

function downloadText(text, fileName) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function saveAsFileName() {
  if (!state.fileName) return "fusion-expressions-edited.setting";
  return state.fileName.replace(/(\.[^.]+)?$/, "-edited$1");
}

function markSaved(updatedText) {
  const documentData = parseFusionDocument(updatedText);
  const previousSelection = selectedExpression();
  const previousRoot = activeRoot();

  state.originalText = updatedText;
  state.roots = documentData.roots;
  state.tools = documentData.tools;
  state.expressions = documentData.expressions;
  state.activeRootId = previousRoot
    ? state.roots.find((root) => root.name === previousRoot.name && root.toolType === previousRoot.toolType)?.id ?? state.roots[0]?.id ?? null
    : state.roots[0]?.id ?? null;
  syncActiveRoot();
  state.expandedTools = new Set([...state.expandedTools].filter((toolName) => {
    return activeTools().some((tool) => tool.name === toolName);
  }));

  const nextSelection = previousSelection
    ? toolExpressions().find((item) => {
      return item.toolId === previousSelection.toolId && item.inputName === previousSelection.inputName;
    })
    : null;
  state.selectedId = nextSelection?.id ?? toolExpressions()[0]?.id ?? null;
  els.fileStatus.textContent = `saved · ${fileStatusText(state.fileName, state.header, activeTools().length, toolExpressions().length)}`;
  renderStructure();
  renderTabs();
  renderHeader();
  renderList();
  renderEditor();
}

function fileStatusText(fileName, header, toolCount, expressionCount) {
  const headerLabel = header ? `${header.operatorType} ${header.name}` : "no Header";
  return `${fileName} · ${headerLabel} · ${toolCount} tools · ${expressionCount} expressions`;
}

function isProtectedFileSystemError(error) {
  const message = `${error.name ?? ""} ${error.message ?? ""}`.toLowerCase();
  return [
    "system",
    "sensitive",
    "blocked",
    "not allowed",
    "not permitted",
    "security",
  ].some((pattern) => message.includes(pattern));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function handleFallbackEditorKeydown(event) {
  if (event.key !== "Tab") return;

  event.preventDefault();
  const textarea = event.currentTarget;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = `${textarea.value.slice(0, start)}    ${textarea.value.slice(end)}`;
  textarea.selectionStart = textarea.selectionEnd = start + 4;
  updateSelectedExpression(textarea.value);
}
