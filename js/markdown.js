/* Markdown — compact full-flavor renderer (headings, code, lists, tasks, tables).
   Offline, no dependencies. Output is sanitized: raw HTML is escaped BEFORE
   parsing, links/images allow http(s)/mailto/data:pdf,image only. */
(function () {
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function safeUrl(u, pdfOk) {
    const s = String(u || "").trim();
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    if (pdfOk && /^data:(application\/pdf|image\/[a-z+]+);base64,/i.test(s)) return s;
    if (/^#/.test(s)) return s;
    return "";
  }

  // Inline: code spans protected via placeholders, then img/link/emphasis.
  function inline(src) {
    const codes = [];
    let out = String(src);
    out = out.replace(/`([^`\n]+)`/g, (m, c) => {
      codes.push("<code>" + esc(c) + "</code>");
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    out = esc(out);
    // images ![alt](url) — URL may contain one paren pair, e.g. _(1).pdf
    out = out.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))+)(?:\s+"[^"]*")?\)/g, (m, alt, url) => {
      const u = safeUrl(url, true);
      if (!u) return esc(alt || "image");
      return '<img alt="' + esc(alt) + '" loading="lazy" src="' + esc(u) + '"/>';
    });
    // links [text](url)
    out = out.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)(?:\s+"[^"]*")?\)/g, (m, t, url) => {
      const u = safeUrl(url, false);
      if (!u) return esc(t);
      return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + "</a>";
    });
    // autolinks
    out = out.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (m, pre, u) =>
      pre + '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + "</a>");
    // strikethrough, bold, italic (order matters)
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    out = out.replace(/(^|\W)_([^_\n]+)_(\W|$)/g, "$1<em>$2</em>$3");
    // restore code spans
    out = out.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i] || "");
    return out;
  }

  function isTableSep(line) {
    const cells = line.trim().replace(/^\||\|$/g, "").split("|");
    return cells.length > 0 && cells.every((c) => /^\s*:?-{1,}:?\s*$/.test(c));
  }
  function splitRow(line) {
    return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  }

  function render(src) {
    const lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
    let html = "";
    let i = 0;
    let listStack = []; // {type, indent}

    function closeLists(toIndent) {
      while (listStack.length && listStack[listStack.length - 1].indent >= toIndent) {
        const l = listStack.pop();
        html += l.type === "ol" ? "</ol>" : "</ul>";
      }
    }

    while (i < lines.length) {
      const line = lines[i];
      // fenced code
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        closeLists(0);
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // skip closing fence
        html += '<pre><code' + (fence[1] ? ' data-lang="' + esc(fence[1]) + '"' : "") + ">"
          + esc(buf.join("\n")) + "</code></pre>";
        continue;
      }
      if (/^\s*$/.test(line)) { closeLists(0); i++; continue; }
      // table: header + separator
      if (line.indexOf("|") !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        closeLists(0);
        const head = splitRow(line);
        i += 2;
        html += "<table><thead><tr>" + head.map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
        while (i < lines.length && lines[i].indexOf("|") !== -1 && !/^\s*$/.test(lines[i])) {
          html += "<tr>" + splitRow(lines[i]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>";
          i++;
        }
        html += "</tbody></table>";
        continue;
      }
      // heading
      let m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        closeLists(0);
        html += "<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">";
        i++;
        continue;
      }
      // hr
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeLists(0); html += "<hr/>"; i++; continue; }
      // blockquote
      m = line.match(/^>\s?(.*)$/);
      if (m) {
        closeLists(0);
        const buf = [];
        while (i < lines.length) {
          const q = lines[i].match(/^>\s?(.*)$/);
          if (!q) break;
          buf.push(q[1]);
          i++;
        }
        html += "<blockquote>" + inline(buf.join(" ")) + "</blockquote>";
        continue;
      }
      // list item (ordered, unordered, task)
      m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (m) {
        const indent = m[1].replace(/\t/g, "  ").length;
        const ordered = /^\d/.test(m[2]);
        const type = ordered ? "ol" : "ul";
        let rest = m[3];
        // close deeper, open new level as needed
        if (!listStack.length || indent > listStack[listStack.length - 1].indent) {
          html += type === "ol" ? "<ol>" : "<ul>";
          listStack.push({ type, indent });
        } else {
          closeLists(indent);
          const top = listStack[listStack.length - 1];
          if (!top || top.indent !== indent || top.type !== type) {
            closeLists(indent + 1);
            html += type === "ol" ? "<ol>" : "<ul>";
            listStack.push({ type, indent });
          }
        }
        const task = rest.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          const checked = task[1].toLowerCase() === "x";
          html += '<li class="task"><input type="checkbox" disabled' + (checked ? " checked" : "")
            + "/><span>" + inline(task[2]) + "</span></li>";
        } else {
          html += "<li>" + inline(rest) + "</li>";
        }
        i++;
        continue;
      }
      // paragraph: gather until blank / block start
      closeLists(0);
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i])
        && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|(\s*)(---|\*\*\*|___)\s*$)/.test(lines[i])
        && !(lines[i].indexOf("|") !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
        buf.push(lines[i]);
        i++;
      }
      html += "<p>" + inline(buf.join(" ")) + "</p>";
    }
    closeLists(0);
    return html || '<p class="md-empty">EMPTY MARKDOWN</p>';
  }

  window.SignalMarkdown = { render, esc };
})();
