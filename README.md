# Fusion Expression Editor

Local web app for opening Fusion `.setting` or `.comp` files, editing a `MacroOperator`/`GroupOperator` header, browsing Tools as a tree, editing controls with `Expression`, and saving the text back while keeping the rest of the file intact.

## Usage

1. Start the server from this folder:

   ```sh
   python3 -m http.server 4173
   ```

2. Open `http://127.0.0.1:4173/`.
3. Use `Open` to load a file through the File System Access API. In that mode, `Save` writes to the opened file.
4. Use `Paste` to load `.setting` text directly from the clipboard. In that mode, `Save` opens the same flow as `Save As`.
5. Use `Save As` whenever you want to export a copy instead of overwriting the opened file.

The `Header` tab lets you switch between `MacroOperator` and `GroupOperator`, and shows the header `InstanceInput`/`InstanceOutput` entries. If an item has a `Name` field, it can be edited.

The `Tools` tab detects internal Tool blocks, shows their `Input` entries with `Expression = "..."`, and keeps the original positions so only edited values are replaced.
