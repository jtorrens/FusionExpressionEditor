const state = {
  fileHandle: null,
  fileName: "",
  originalText: "",
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

const els = {
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
els.expressionEditor.addEventListener("input", updateSelectedExpression);
els.expressionEditor.addEventListener("keydown", handleEditorKeydown);
els.revertBtn.addEventListener("click", revertSelectedExpression);

if (!("showOpenFilePicker" in window)) {
  els.openPickerBtn.hidden = true;
}

async function openWithPicker() {
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
    if (error.name !== "AbortError") {
      els.fileStatus.textContent = `Could not open file: ${error.message}`;
    }
  }
}

async function openFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      els.fileStatus.textContent = "Clipboard is empty.";
      return;
    }

    state.fileHandle = null;
    await loadDocumentText(text, "clipboard.setting");
  } catch (error) {
    els.fileStatus.textContent = `Could not read clipboard: ${error.message}`;
  }
}

async function loadDocumentText(text, fileName) {
  const documentData = parseFusionDocument(text);

  state.fileName = fileName;
  state.originalText = text;
  state.header = documentData.header;
  state.tools = documentData.tools;
  state.expressions = documentData.expressions;
  state.selectedId = toolExpressions()[0]?.id ?? null;
  state.expandedTools = new Set(state.tools.map((tool) => tool.name));
  state.activeTab = state.header ? "header" : "tools";
  state.replaceMode = false;
  state.replaceSelectedIds = new Set();

  els.searchInput.disabled = false;
  els.replaceModeBtn.disabled = false;
  els.saveBtn.disabled = false;
  els.downloadBtn.disabled = false;
  els.copyBtn.disabled = false;
  els.fileStatus.textContent = fileStatusText(fileName, state.header, state.tools.length, state.expressions.length);

  renderTabs();
  renderReplacePanel();
  renderHeader();
  renderList();
  renderEditor();
}

function parseFusionDocument(text) {
  const tokens = tokenizeFusion(text);
  const stack = [];
  const tools = [];
  const toolsByName = new Map();
  const expressions = [];
  const headerItems = { Inputs: [], Outputs: [] };
  let header = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.type === "{") {
      const context = contextFromOpeningBrace(tokens, i);
      const parentSection = lastStackItem(stack, "section");

      if (context.kind === "header" && !header) {
        header = {
          name: context.name,
          operatorType: context.toolType,
          originalOperatorType: context.toolType,
          typeStart: context.typeStart,
          typeEnd: context.typeEnd,
          inputs: headerItems.Inputs,
          outputs: headerItems.Outputs,
        };
      } else if (context.kind === "tool" && !toolsByName.has(context.name)) {
        const tool = {
          id: tools.length,
          name: context.name,
          toolType: context.toolType,
          line: lineAt(text, token.start),
        };
        tools.push(tool);
        toolsByName.set(tool.name, tool);
      } else if (context.kind === "headerItem" && parentSection) {
        headerItems[parentSection.name]?.push(parseHeaderItem(text, tokens, i, context, parentSection.name));
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

  return { header, tools, expressions };
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

    if (!["FuID", "OperatorInfo"].includes(prev.token.value)) {
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

function renderList() {
  const query = els.searchInput.value.trim().toLowerCase();
  const replaceFind = els.replaceFindInput.value;
  const expressionsByTool = toolExpressions();
  const visibleTools = state.tools
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
        <strong>${escapeHtml(group.tool.name)}</strong>
        <span>${escapeHtml(group.tool.toolType)} · ${group.expressions.length} expressions</span>
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

function renderEditor() {
  const item = selectedExpression();
  els.emptyState.hidden = Boolean(item);
  els.editorState.hidden = !item;

  if (!item) return;

  els.toolName.textContent = `${item.toolName}${item.toolType ? ` · ${item.toolType}` : ""}`;
  els.inputName.textContent = item.inputName;
  els.expressionEditor.value = item.current;
  els.originalExpressionViewer.textContent = item.original;
  els.dirtyBadge.hidden = !isChanged(item);
  els.lineInfo.textContent = `Line ${item.line}`;
}

function updateSelectedExpression() {
  const item = selectedExpression();
  if (!item) return;

  item.current = els.expressionEditor.value;
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
  return state.expressions.filter((item) => item.toolId && item.toolName !== "Tool desconocido");
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
  const header = state.header;
  if (!header) return [];

  const replacements = [];
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
    els.fileStatus.textContent = `copied · ${fileStatusText(state.fileName, state.header, state.tools.length, state.expressions.length)}`;
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

  state.originalText = updatedText;
  state.header = documentData.header;
  state.tools = documentData.tools;
  state.expressions = documentData.expressions;
  state.expandedTools = new Set([...state.expandedTools].filter((toolName) => {
    return state.tools.some((tool) => tool.name === toolName);
  }));

  const nextSelection = previousSelection
    ? toolExpressions().find((item) => {
      return item.toolId === previousSelection.toolId && item.inputName === previousSelection.inputName;
    })
    : null;
  state.selectedId = nextSelection?.id ?? toolExpressions()[0]?.id ?? null;
  els.fileStatus.textContent = `saved · ${fileStatusText(state.fileName, state.header, state.tools.length, state.expressions.length)}`;
  renderHeader();
  renderList();
  renderEditor();
}

function fileStatusText(fileName, header, toolCount, expressionCount) {
  const headerLabel = header ? `${header.operatorType} ${header.name}` : "no Header";
  return `${fileName} · ${headerLabel} · ${toolCount} tools · ${expressionCount} expressions`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function handleEditorKeydown(event) {
  if (event.key !== "Tab") return;

  event.preventDefault();
  const textarea = event.currentTarget;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = `${textarea.value.slice(0, start)}    ${textarea.value.slice(end)}`;
  textarea.selectionStart = textarea.selectionEnd = start + 4;
  updateSelectedExpression();
}
