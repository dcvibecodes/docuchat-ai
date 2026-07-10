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
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractPdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  return {
    text: cleanText(data.text),
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
  const result = await mammoth.extractRawText({ buffer });

  return {
    text: cleanText(result.value),
    pageCount: null, // DOCX doesn't have fixed pages
    metadata: {}
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
