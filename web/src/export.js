const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', reopened: 'Reopened' };

function rows(project, comments) {
  return comments
    .filter((c) => !c.parent_comment_id)
    .map((c) => ({
      ref: c.ref || '',
      status: STATUS_LABEL[c.status] || c.status,
      type: c.type,
      priority: c.priority,
      page: c.page_path || '',
      element: c.element_selector || '',
      elementText: c.element_snapshot?.textSnippet || '',
      author: c.author_name,
      comment: c.content,
      replies: (c.replies || [])
        .map((r) => `${r.author_name}: ${r.content}`)
        .join('\n'),
      replyCount: (c.replies || []).length,
      created: new Date(c.created_at).toLocaleString(),
      internal: c.is_internal ? 'Yes' : 'No',
    }));
}

function baseName(project) {
  const date = new Date().toISOString().slice(0, 10);
  return `${project.name.replace(/[^\w-]+/g, '_')}-feedback-${date}`;
}

export function exportCSV(project, comments) {
  const data = rows(project, comments);
  const headers = ['Ref', 'Status', 'Type', 'Priority', 'Page', 'Element', 'Element text', 'Author', 'Comment', 'Replies', 'Reply count', 'Created', 'Internal'];
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(','),
    ...data.map((r) =>
      [r.ref, r.status, r.type, r.priority, r.page, r.element, r.elementText, r.author, r.comment, r.replies, r.replyCount, r.created, r.internal]
        .map(escape)
        .join(',')
    ),
  ].join('\r\n');
  download(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `${baseName(project)}.csv`);
}

export async function exportExcel(project, comments) {
  const XLSX = await import('xlsx');
  const data = rows(project, comments);
  const sheets = data.map((r) => ({
    Ref: r.ref, Status: r.status, Type: r.type, Priority: r.priority, Page: r.page,
    Element: r.element, 'Element text': r.elementText, Author: r.author, Comment: r.comment,
    Replies: r.replies || '', 'Reply count': r.replyCount, Created: r.created, Internal: r.internal,
  }));
  const ws = XLSX.utils.json_to_sheet(sheets);
  ws['!cols'] = [
    { wch: 9 }, { wch: 12 }, { wch: 11 }, { wch: 9 }, { wch: 12 }, { wch: 28 }, { wch: 24 },
    { wch: 16 }, { wch: 50 }, { wch: 50 }, { wch: 6 }, { wch: 20 }, { wch: 9 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Feedback');
  XLSX.writeFile(wb, `${baseName(project)}.xlsx`);
}

export async function exportPDF(project, comments) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'landscape' });
  const data = rows(project, comments);

  doc.setFontSize(16);
  doc.text(project.name, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `Notely feedback export · ${data.length} comment${data.length === 1 ? '' : 's'} · ${new Date().toLocaleString()}`,
    14,
    22
  );

  autoTable(doc, {
    startY: 26,
    head: [['Ref', 'Status', 'Type', 'Priority', 'Page', 'Element', 'Author', 'Comment', 'Replies', 'Created']],
    body: data.map((r) => [
      r.ref, r.status, r.type, r.priority, r.page, r.elementText || r.element, r.author, r.comment,
      r.replies || '—', r.created,
    ]),
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [79, 70, 229] },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 20 },
      2: { cellWidth: 18 },
      3: { cellWidth: 16 },
      4: { cellWidth: 18 },
      5: { cellWidth: 40 },
      6: { cellWidth: 26 },
      8: { cellWidth: 50 },
      9: { cellWidth: 28 },
    },
  });
  doc.save(`${baseName(project)}.pdf`);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
