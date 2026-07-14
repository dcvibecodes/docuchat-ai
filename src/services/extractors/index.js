const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

async function extractText(filePath, fileType) {
  switch (fileType) {
    case 'pdf':
      return extractPdf(filePath);
    case 'docx':
      return extractDocx(filePath);
    case 'txt':
      return extractTxt(filePath);
    case 'md':
      return extractMarkdown(filePath);
    case 'xlsx':
    case 'xls':
      return extractExcel(filePath);
    case 'csv':
      return extractCsv(filePath);
    case 'url':
      return extractTxt(filePath); // URL content is saved as plain text
    case 'sqlite':
    case 'db':
    case 'sqlite3':
      return extractSqlite(filePath);
    case 'sql':
      return extractSqlDump(filePath);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractPdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);

  // Custom page render to extract text page-by-page with markers
  let pageTexts = [];
  const options = {
    pagerender: function(pageData) {
      return pageData.getTextContent().then(function(textContent) {
        let pageText = '';
        let lastY = null;
        for (const item of textContent.items) {
          if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
            pageText += '\n';
          }
          pageText += item.str;
          lastY = item.transform[5];
        }
        return pageText;
      });
    }
  };

  const data = await pdfParse(buffer, options);

  // Re-parse page by page to get individual page texts
  // pdf-parse doesn't directly give per-page text, so we use a workaround:
  // Parse again with a custom render that collects pages separately
  pageTexts = [];
  const options2 = {
    pagerender: function(pageData) {
      return pageData.getTextContent().then(function(textContent) {
        let pageText = '';
        let lastY = null;
        for (const item of textContent.items) {
          if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
            pageText += '\n';
          }
          pageText += item.str;
          lastY = item.transform[5];
        }
        pageTexts.push(pageText);
        return pageText;
      });
    }
  };
  await pdfParse(buffer, options2);

  // Build text with page markers that the chunker can use
  let fullText = '';
  for (let i = 0; i < pageTexts.length; i++) {
    fullText += `\n---PAGE ${i + 1}---\n${pageTexts[i]}`;
  }

  return {
    text: cleanText(fullText),
    pageCount: data.numpages,
    metadata: {
      title: data.info?.Title || null,
      author: data.info?.Author || null
    }
  };
}

async function extractDocx(filePath) {
  const mammoth = require('mammoth');
  const buffer = fs.readFileSync(filePath);

  // Use convertToHtml to detect headings, then extract structured text
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const html = htmlResult.value;

  // Parse HTML to extract text with heading markers for section tracking
  // Convert headings to section markers the chunker can use
  let text = html
    // Convert headings to markers
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n---SECTION: $1---\n\n')
    // Convert list items
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    // Convert paragraphs to double newlines
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    // Convert line breaks
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove all remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  return {
    text: cleanText(text),
    pageCount: null,
    metadata: { format: 'docx' }
  };
}

async function extractTxt(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  return {
    text: cleanText(text),
    pageCount: null,
    metadata: {}
  };
}

async function extractMarkdown(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  return {
    text: cleanText(text),
    pageCount: null,
    metadata: {
      format: 'markdown'
    }
  };
}

async function extractExcel(filePath) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheets = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      sheets.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    }
  }
  return {
    text: cleanText(sheets.join('\n\n')),
    pageCount: workbook.SheetNames.length,
    metadata: { format: 'excel', sheets: workbook.SheetNames.length }
  };
}

async function extractCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  return {
    text: cleanText(text),
    pageCount: null,
    metadata: { format: 'csv' }
  };
}

async function extractSqlite(filePath) {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(filePath);
  const database = new SQL.Database(buffer);

  let text = '';
  let tableCount = 0;
  let totalRows = 0;

  try {
    // Get all user tables (skip internal SQLite tables)
    const tables = database.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );

    if (!tables.length || !tables[0].values.length) {
      throw new Error('Database contains no tables');
    }

    const tableNames = tables[0].values.map(row => row[0]);
    tableCount = tableNames.length;

    for (const tableName of tableNames) {
      // Get row count
      let rowCount = 0;
      try {
        const countResult = database.exec(`SELECT COUNT(*) FROM "${tableName}"`);
        rowCount = countResult[0]?.values[0]?.[0] || 0;
      } catch (e) { continue; }

      // Get column info
      let columns = [];
      try {
        const colInfo = database.exec(`PRAGMA table_info("${tableName}")`);
        if (colInfo.length) {
          columns = colInfo[0].values.map(row => ({ name: row[1], type: row[2] }));
        }
      } catch (e) { /* skip */ }

      text += `\n\n---TABLE: ${tableName} (${rowCount} rows)---\n`;
      text += `Columns: ${columns.map(c => c.name + ' (' + c.type + ')').join(', ')}\n\n`;

      // Extract rows — focus on text-heavy columns, cap at 2000 rows per table
      const limit = Math.min(rowCount, 2000);
      try {
        const result = database.exec(`SELECT * FROM "${tableName}" LIMIT ${limit}`);
        if (result.length && result[0].values.length) {
          const colNames = result[0].columns;

          // For tables with many columns, format as key:value per row
          // For tables with few columns, format as CSV-like
          if (colNames.length <= 6) {
            // CSV-style: header row + data
            text += colNames.join(' | ') + '\n';
            text += '-'.repeat(colNames.join(' | ').length) + '\n';
            for (const row of result[0].values) {
              text += row.map(v => formatCellValue(v)).join(' | ') + '\n';
            }
          } else {
            // Key-value style for wide tables (better for RAG)
            for (const row of result[0].values) {
              const entries = [];
              for (let i = 0; i < colNames.length; i++) {
                const val = formatCellValue(row[i]);
                if (val && val !== 'NULL') {
                  entries.push(`${colNames[i]}: ${val}`);
                }
              }
              if (entries.length) {
                text += entries.join(', ') + '\n';
              }
            }
          }
          totalRows += result[0].values.length;

          if (rowCount > limit) {
            text += `\n... (${rowCount - limit} more rows truncated)\n`;
          }
        }
      } catch (e) {
        text += `(Error reading table: ${e.message})\n`;
      }
    }
  } finally {
    database.close();
  }

  if (!text.trim()) {
    throw new Error('Could not extract any text content from the database');
  }

  logger.info('SQLite extracted', { tables: tableCount, rows: totalRows, textLength: text.length });

  return {
    text: cleanText(text),
    pageCount: tableCount,
    metadata: { format: 'sqlite', tables: tableCount, rows: totalRows }
  };
}

async function extractSqlDump(filePath) {
  // SQL dump files — extract INSERT statements, CREATE TABLEs, and comments
  const raw = fs.readFileSync(filePath, 'utf-8');
  let text = '';
  let tableCount = 0;

  const lines = raw.split('\n');
  let currentTable = null;
  let columns = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and pure SQL comments that aren't meaningful
    if (!trimmed || trimmed.startsWith('--') && trimmed.length < 5) continue;

    // Capture meaningful comments (often contain context)
    if (trimmed.startsWith('--') && trimmed.length >= 5) {
      text += trimmed.replace(/^--\s*/, '') + '\n';
      continue;
    }

    // CREATE TABLE — extract structure
    const createMatch = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i);
    if (createMatch) {
      currentTable = createMatch[1];
      tableCount++;
      text += `\n---TABLE: ${currentTable}---\n`;
      columns = [];
      continue;
    }

    // Column definitions inside CREATE TABLE
    if (currentTable && !trimmed.match(/^(PRIMARY|UNIQUE|INDEX|KEY|CONSTRAINT|CREATE|INSERT|DROP|\))/i)) {
      const colMatch = trimmed.match(/^[`"']?(\w+)[`"']?\s+(\w+)/);
      if (colMatch) {
        columns.push(colMatch[1]);
      }
    }

    // End of CREATE TABLE
    if (currentTable && trimmed.startsWith(')')) {
      if (columns.length) text += `Columns: ${columns.join(', ')}\n`;
      currentTable = null;
      columns = [];
      continue;
    }

    // INSERT statements — extract the values
    const insertMatch = trimmed.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"']?(\w+)[`"']?\s*/i);
    if (insertMatch) {
      const valuesMatch = trimmed.match(/VALUES\s*\((.+)\)/i);
      if (valuesMatch) {
        // Parse the values — extract text content
        const values = valuesMatch[1]
          .replace(/'([^']*(?:''[^']*)*)'/g, (m, v) => v.replace(/''/g, "'")) // Unescape SQL strings
          .replace(/NULL/gi, '')
          .split(',')
          .map(v => v.trim().replace(/^'|'$/g, ''))
          .filter(v => v && v.length > 0);

        if (values.some(v => v.length > 20)) {
          // Only include rows with meaningful text content
          text += values.filter(v => v.length > 3).join(' | ') + '\n';
        }
      }
    }
  }

  if (!text.trim() || text.trim().length < 50) {
    // Fallback: just return the whole file as text (it's still searchable)
    return {
      text: cleanText(raw),
      pageCount: tableCount || null,
      metadata: { format: 'sql-dump', tables: tableCount }
    };
  }

  logger.info('SQL dump extracted', { tables: tableCount, textLength: text.length });

  return {
    text: cleanText(text),
    pageCount: tableCount || null,
    metadata: { format: 'sql-dump', tables: tableCount }
  };
}

function formatCellValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (val instanceof Uint8Array) return '(binary data)';
  const str = String(val);
  // Truncate very long cell values (e.g., base64 blobs stored as text)
  if (str.length > 500) return str.substring(0, 500) + '...';
  return str;
}

function cleanText(text) {
  if (!text) return '';

  return text
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive whitespace but preserve paragraph breaks
    .replace(/[ \t]+/g, ' ')
    // Remove more than 2 consecutive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Trim each line
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();
}

module.exports = { extractText, cleanText };
