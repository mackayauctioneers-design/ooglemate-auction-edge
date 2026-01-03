/**
 * One-time ingestion script for Mackay Traders StockSoldReport PDF
 * 
 * This script parses the pre-extracted markdown content from the PDF
 * and stores it in the Dealer_Sales_History sheet.
 */

import { parseEasyCarsReport, toSalesHistoryRecords } from './easyCarsParser';
import { googleSheetsService } from '@/services/googleSheetsService';

// Pre-extracted markdown content from the PDF (this would normally come from the parsed document)
const MACKAY_TRADERS_REPORT_MARKDOWN = `
| Stock No | No   | Rego    | Description                                                                                   | Sale Date | Days in Stock | Sold to                       | Total Selling Price inc Extras and GST | Net Over Expenses, Warranty Allowance and GST | Net GST liability | Profit   |            |
| -------- | ---- | ------- | --------------------------------------------------------------------------------------------- | --------- | ------------- | ----------------------------- | -------------------------------------- | --------------------------------------------- | ----------------- | -------- | ---------- |
| 1276     | 2604 | CP46AD  | Holden Cruze 2011 JH Series II MY11 CD Sedan 4dr Spts Auto 6sp 2.0DT                          | 09/10/25  | 588           | David Anthony Mackay          | $1,800.00                              | $0.00                                         | $1,800.00         | $0.00    | $0.00      |
| 1702     | 2615 |         | Nissan Patrol 2009 GU 6 MY08 ST Cab Chassis Single Cab 2dr Man 5sp 4x4 1141kg 3.0DT (Coil)    | 14/10/25  | 426           | Benjamin James Lansdowne      | $5,000.00                              | $0.00                                         | $8,000.00         | -$272.72 | -$2,727.28 |
| 1807     | 2605 | AU27472 | Subaru Outback 2008 B4A MY08 Premium Pack Wagon 5dr Spts Auto 4sp AWD 2.5i                    | 09/10/25  | 381           | David Anthony Mackay          | $800.00                                | $0.00                                         | $800.00           | $0.00    | $0.00      |
| 1871     | 2473 |         | Toyota Landcruiser 1993 FZJ80R GXL Wagon 8st 5dr Man 5sp 4WD 4.5i                             | 24/07/25  | 268           | ACM Cars & Commcercial        | $15,000.00                             | $0.00                                         | $12,500.00        | $227.28  | $2,272.72  |
| 2236     | 2620 | DSL87S  | Nissan Navara 2015 D23 ST Utility Dual Cab 4dr Man 6sp 4x2 1074kg 2.3DTT                      | 16/10/25  | 199           | Port Macquarie Wholesale Cars | $4,000.00                              | $0.00                                         | $4,800.00         | -$72.72  | -$727.28   |
| 2257     | 2656 | BHM52Z  | BMW X3 2008 E83 MY09 xDrive20d Lifestyle Wagon 5dr Steptronic 6sp, 4WD 2.0DT                  | 03/11/25  | 208           | United Auctions Australia     | $2,000.00                              | $0.00                                         | $2,600.00         | -$54.54  | -$545.46   |
| 2277     | 2610 |         | Toyota Landcruiser 2008 VDJ200R Sahara Wagon 8st 5dr Spts Auto 6sp 4x4 4.5DTT                 | 25/10/25  | 192           | SGS HAULAGE PTY LTD           | $75,000.00                             | $0.00                                         | $75,000.00        | $0.00    | $0.00      |
| 2305     | 2463 | AC30KV  | Hyundai Getz 2004 TB MY04 XL Hatchback 3dr Auto 4sp 1.3i                                      | 18/07/25  | 73            | AJH Auto Traders Pty Ltd      | $700.00                                | $0.00                                         | $800.00           | -$9.09   | -$90.91    |
| 2308     | 2468 | DSE12K  | Audi A4 2008 B7 TDI Sedan 4dr multitronic 7sp 2.0DT                                           | 22/07/25  | 76            | AJH Auto Traders Pty Ltd      | $1,250.00                              | $0.00                                         | $1,000.00         | $22.73   | $227.27    |
| 2318     | 2475 | DJB95F  | Nissan Dualis 2012 J10W Series 3 MY12 ST Hatch 5dr X-tronic 6sp 2WD 2.0i                      | 25/07/25  | 73            | Budget Auto Group PTY LTD     | $2,000.00                              | $0.00                                         | $2,000.00         | $0.00    | $0.00      |
| 2319     | 2606 | BZH97F  | Mitsubishi Challenger 2011 PB (KH) MY11 XLS Wagon 5dr Spts Auto 5sp, 4x4 2.5DT                | 09/10/25  | 147           | Budget Auto Group PTY LTD     | $3,500.00                              | $0.00                                         | $3,500.00         | $0.00    | $0.00      |
| 2321     | 2609 | AZF45T  | Holden Calais 2006 VE Sedan 4dr Spts Auto 5sp 3.6i                                            | 10/10/25  | 147           | AJH Auto Traders Pty Ltd      | $1,700.00                              | $0.00                                         | $2,000.00         | -$27.27  | -$272.73   |
| 2334     | 2455 | EVY68F  | Volkswagen Tiguan 2019 5N MY19.5 162TSI Highline Allspace Wagon 7st 5dr DSG 7sp, 4MOTION 2.0T | 15/07/25  | 54            | AJH Auto Traders Pty Ltd      | $16,400.00                             | $0.00                                         | $19,000.00        | -$236.36 | -$2,363.64 |
| 2349     | 2414 | DSF67F  | BMW 3 Series 2017 F30 LCI 320i Sport Line Sedan 4dr Spts Auto 8sp, 2.0T                       | 01/07/25  | 33            | AJH Auto Traders Pty Ltd      | $12,500.00                             | $0.00                                         | $10,000.00        | $227.27  | $2,272.73  |
| 2354     | 2441 | CTM31R  | Nissan Navara 2012 D40 S6 ST Utility Dual Cab 4dr Spts Auto 5sp 4x4 769kg 2.5DT               | 10/07/25  | 41            | John Paul Borg                | $8,000.00                              | $0.00                                         | $5,000.00         | $272.72  | $2,727.28  |
| 2355     | 2439 | BI48KP  | Volkswagen Jetta 2008 1KM MY08 TDI Sedan 4dr DSG 6sp, 2.0DT                                   | 10/07/25  | 41            | Blake Michael Marcikic        | $4,000.00                              | $0.00                                         | $2,000.00         | $181.82  | $1,818.18  |
| 2357     | 2482 | CL85YC  | Suzuki Liana 2005 RH418 Type 5 Sedan 4dr Man 5sp 1.8i                                         | 29/07/25  | 60            | AJH Auto Traders Pty Ltd      | $400.00                                | $0.00                                         | $1,000.00         | -$54.55  | -$545.45   |
| 2358     | 2487 | CIN45Y  | Kia Sorento 2012 XM MY12 SLi Wagon 7st 5dr Spts Auto 6sp 4WD 2.2DT                            | 04/08/25  | 66            | Robert Ernest Staff           | $8,000.00                              | $0.00                                         | $7,300.00         | $63.63   | $636.37    |
| 2359     | 2419 | BPK18X  | Mazda 3 2010 BL10F1 Neo Sedan 4dr Man 6sp 2.0i                                                | 03/07/25  | 30            | Cherrie Cathylee Prentice     | $2,000.00                              | $0.00                                         | $1,000.00         | $90.91   | $909.09    |
| 2360     | 2413 | DDV47A  | Toyota Corolla 2006 ZZE122R 5Y Conquest Hatchback 5dr Auto 4sp 1.8i                           | 01/07/25  | 28            | AJH Auto Traders Pty Ltd      | $4,600.00                              | $0.00                                         | $4,000.00         | $54.54   | $545.46    |
| 2425     | 2395 |         | Toyota Landcruiser 2025 VDJL79R GXL Cab Chassis Double Cab 4dr Man 5sp 4x4 4.5DT              | 01/07/25  | 6             | John Hughes Group             | $108,000.00                            | $0.00                                         | $97,000.00        | $1,000.00| $10,000.00 |
| 2426     | 2386 | 3OOGX   | Toyota Landcruiser 2024 FJA300R GX Wagon 5dr Spts Auto 10sp 4x4 3.3DTT                        | 01/07/25  | 5             | Westside Auto Wholesale       | $95,500.00                             | $0.00                                         | $93,500.00        | $181.82  | $1,818.18  |
| 2433     | 2387 | 1YS1NE  | Ford Ranger 2023 PY MY23.50 Wildtrak Pick-up Double Cab 4dr Spts Auto 10sp 4x4 901kg 2.0DTT   | 01/07/25  | 4             | Klosters                      | $53,000.00                             | $0.00                                         | $51,000.00        | $181.82  | $1,818.18  |
| 2444     | 2402 | 948DC2  | Isuzu MU-X 2021 RJ MY21 LS-U Wagon 7st 5dr Rev-Tronic 6sp 4x4 3.0DT                           | 01/07/25  | 4             | Car Giant WA                  | $40,500.00                             | $0.00                                         | $37,500.00        | $272.73  | $2,727.27  |
| 2417     | 2377 | YRK80Y  | Isuzu D-MAX 2018 MY17 LS-U Utility Space Cab 4dr Spts Auto 6sp 4x4 969kg 3.0DT                | 01/07/25  | 7             | Brian Hilton Motor Group      | $32,000.00                             | $0.00                                         | $28,912.00        | $280.73  | $2,807.27  |
| 2424     | 2383 | EPA63A  | Nissan Patrol 2021 Y62 MY21 Ti Wagon 8st 5dr Spts Auto 7sp 4x4 5.6i                           | 01/07/25  | 6             | Illawarra Toyota              | $68,500.00                             | $0.00                                         | $66,000.00        | $227.27  | $2,272.73  |
| 2719     | 2710 | FGG37P  | Toyota Landcruiser 2017 VDJ200R GXL Wagon 8st 5dr Spts Auto 6sp 4x4 4.5DTT                    | 02/12/25  | 1             | John Hughes Group             | $75,000.00                             | $0.00                                         | $73,000.00        | $181.82  | $1,818.18  |
| 2720     | 2712 | 047AU2  | Isuzu D-MAX 2020 RG MY21 SX Cab Chassis Single Cab 2dr Spts Auto 6sp 4x4 1310kg 3.0DT         | 03/12/25  | 1             | Westside Auto Wholesale       | $34,700.00                             | $0.00                                         | $33,470.00        | $111.82  | $1,118.18  |
| 2742     | 2736 | EUI75A  | Toyota Landcruiser 2022 FJA300R GR Sport Wagon 5dr Spts Auto 10sp 4x4 3.3DTT                  | 15/12/25  | 3             | ZSL Trading Pty Ltd           | $112,000.00                            | $0.00                                         | $110,000.00       | $181.82  | $1,818.18  |
| 2747     | 2745 | EAX21R  | Toyota Hilux 2018 GUN126R Rugged X Utility Double Cab 4dr Man 6sp 4x4 748kg 2.8DT             | 19/12/25  | 1             | Ozzy Car Sales                | $36,000.00                             | $0.00                                         | $35,000.00        | $90.91   | $909.09    |
| 2726     | 2715 | K       | Ford Mustang 2021 FN MY21.5 GT Fastback 2dr SelectShift 10sp RWD 5.0i                         | 03/12/25  | 1             | Westside Auto Wholesale       | $50,000.00                             | $0.00                                         | $48,000.00        | $181.81  | $1,818.19  |
`;

export async function ingestMackayTradersSales(): Promise<{
  parsed: number;
  stored: number;
  errors: string[];
}> {
  const errors: string[] = [];
  
  try {
    console.log('Parsing Mackay Traders StockSoldReport...');
    
    // Parse the markdown content
    const parsed = parseEasyCarsReport(MACKAY_TRADERS_REPORT_MARKDOWN);
    console.log(`Parsed ${parsed.length} vehicle sales`);
    
    if (parsed.length === 0) {
      errors.push('No sales parsed from report');
      return { parsed: 0, stored: 0, errors };
    }
    
    // Log sample of parsed data
    console.log('Sample parsed records:');
    parsed.slice(0, 3).forEach((sale, i) => {
      console.log(`  ${i + 1}. ${sale.year} ${sale.make} ${sale.model} ${sale.variant} - $${sale.sell_price} (profit: $${sale.gross_profit})`);
    });
    
    // Convert to storage format
    const records = toSalesHistoryRecords(parsed, 'Mackay Traders', 'EasyCars PDF');
    
    // Store in Dealer_Sales_History
    console.log('Storing records in Dealer_Sales_History...');
    const stored = await googleSheetsService.appendDealerSalesHistory(records);
    console.log(`Successfully stored ${stored} records`);
    
    return { parsed: parsed.length, stored, errors };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    errors.push(msg);
    console.error('Ingestion failed:', msg);
    return { parsed: 0, stored: 0, errors };
  }
}

// For direct execution in browser console
if (typeof window !== 'undefined') {
  (window as any).ingestMackayTradersSales = ingestMackayTradersSales;
}
