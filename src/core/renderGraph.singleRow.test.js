import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { renderGraph } from './renderGraph.js';

// A single data row can't form a plot, so renderGraph shows the NO DATA
// placeholder with a "need 2+ points" message instead of a lone floating dot
// (and instead of the old ValidationError that blanked the chart entirely).
// Two or more rows render normally, INCLUDING when every value is equal (a
// zero-width domain that createLinearScale must widen rather than reject).

const globalSettings = { graphDimensions: { width: 1200, height: 800 }, colorScheme: 'default' };
const colorSchemes = { default: ['#037703', '#3E68C6', '#ED8507'] };

function mkSvg() {
  document.body.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);
  return svg;
}

function render(graphConfig, csv) {
  const svg = mkSvg();
  const csvData = d3.csvParse(csv, d3.autoType);
  const result = renderGraph({ svg, csvData, graphConfig, globalSettings, colorSchemes });
  return { svg, result, dots: svg.querySelectorAll('path.dot') };
}

// time x-axis + scatter/line pair (e.g. PyConc-Date-PortCharges-Scatter)
const timeCfg = {
  graphType: 'scatter', xAxis: 'date',
  series: [
    { yAxis: 'port_value', graphType: 'scatter', axisAssignment: 'primary' },
    { yAxis: 'port_roll_median', graphType: 'line', axisAssignment: 'primary' },
  ],
};
const timeHeader = 'date,report_id,port_value,concentrate,cost_basis,currency,port_roll_median';

const payCfg = {
  graphType: 'scatter', xAxis: 'concentrate_grade_val', logX: true,
  series: [{ yAxis: 'final_payability_pct', graphType: 'scatter', axisAssignment: 'primary' }],
};

describe('insufficient-data handling', () => {
  it('one row → NO DATA placeholder with the "need 2 or more" message, not a dot', () => {
    const { svg, result, dots } = render(timeCfg,
      timeHeader + '\n2021-05-01,RPT1,12.5,Pyrite concentrate,per dmt,USD,12.5');
    expect(result.success).toBe(true);
    expect(result.noData).toBe(true);
    expect(dots.length).toBe(0);
    expect(svg.querySelector('.no-data-placeholder')).not.toBeNull();
    expect(svg.textContent).toContain('2 or more are needed to plot');
  });

  it('zero rows → generic NO DATA placeholder', () => {
    const { result, svg } = render(timeCfg, timeHeader);
    expect(result.success).toBe(true);
    expect(result.noData).toBe(true);
    expect(svg.textContent).toContain('No data is currently available');
  });

  it('two rows sharing the same x value (zero-width domain) still render', () => {
    const { result, dots } = render(payCfg,
      'report_id,concentrate_grade_val,final_payability_pct\nRPT1,120,88.5\nRPT2,120,90.0');
    expect(result.success).toBe(true);
    expect(result.noData).toBeFalsy();
    expect(dots.length).toBe(2);
  });

  it('normal multi-row data renders every point', () => {
    const { result, dots } = render(timeCfg,
      timeHeader +
      '\n2021-05-01,RPT1,12.5,Pyrite concentrate,per dmt,USD,12.5' +
      '\n2021-06-01,RPT2,14.0,Pyrite concentrate,per dmt,USD,13.2' +
      '\n2021-07-01,RPT3,11.0,Pyrite concentrate,per dmt,USD,12.5');
    expect(result.success).toBe(true);
    expect(dots.length).toBe(3);
  });
});
