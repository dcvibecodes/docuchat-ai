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
    case 'url':
      return extractTxt(filePath); // URL content is saved as plain text
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
