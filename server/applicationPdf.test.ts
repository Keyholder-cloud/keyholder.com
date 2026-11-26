import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { applicationPdf } from './applicationPdf';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPwd3tKEmIY1TCqYfhqAABe7noQUrS/JQAAAABJRU5ErkJggg==', 'base64');
const data = {
  submitted: '2026-11-26', landlord: 'Sam Lee', rental: 'Unit 2 · 12 Faraday St, Ottawa', rent: '$1,800.00 a month',
  people: [{ name: 'Maya Chen', email: 'maya@example.com', phone: '613-555-0101', employer: 'City Hospital', jobTitle: 'Nurse', income: '$5,200.00' }],
  sections: [{ title: 'Where they live now', rows: [['Address', '10 King St W, Toronto — 3rd floor'], ['Why moving', 'Closer to work '.repeat(12)]] as [string, string][] }],
  ids: ["Driver's licence", 'Passport'], creditScore: 742, creditSource: 'Borrowell',
};

describe('application PDF', () => {
  it("the landlord's copy ends with the ID pages; the applicant's copy has none", async () => {
    const applicant = await PDFDocument.load(await applicationPdf(data));
    const landlord = await PDFDocument.load(await applicationPdf(data, [{ label: "Driver's licence", mime: 'image/png', data: png }, { label: 'Passport', mime: 'image/png', data: png }]));
    expect(landlord.getPageCount()).toBe(applicant.getPageCount() + 2);
    expect(applicant.getTitle()).toBe('Rental application: Maya Chen');
  });
});
