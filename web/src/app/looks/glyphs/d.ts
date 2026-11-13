// Coloured icons for Work Like's buttons, batch d: one per command, by the command's key.
// Drawn for Rodeo from what each command does (never traced from another application).
export const GLYPHS: Readonly<Record<string, string>> = {
  // a grid: lines across a frame, one grid line picked out
  "tool:gridline": `<path d="M4 4h16v16H4z" fill="none" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M9.3 4v16M4 12h16" stroke="var(--g-ink)" stroke-width="1.2"/><path d="M14.7 4v16" stroke="var(--g-hi)" stroke-width="2.6"/>`,
  // a duct with a blade set across it
  "tool:hvacdamper": `<path d="M3 8h18v8H3z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 8.5l-2.5 7M14 8.5l-2.5 7" stroke="var(--g-hi)" stroke-width="2.4" stroke-linecap="round"/>`,
  // a square ceiling diffuser with air arrows round a disc
  "tool:hvacdiffuser": `<rect x="3.5" y="3.5" width="17" height="17" rx="1.5" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.4"/><circle cx="12" cy="12" r="4.2" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.3"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" stroke="var(--g-ink)" stroke-width="1.4" stroke-linecap="round"/>`,
  // a straight rectangular duct, shaded underneath
  "tool:hvacduct": `<rect x="3" y="7" width="18" height="10" fill="var(--g-fill)"/><path d="M3 13h18v4H3z" fill="var(--g-fill2)"/><rect x="3" y="7" width="18" height="10" fill="none" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/>`,
  // a duct narrowing from a wide end to a small end
  "tool:hvactransition": `<path d="M3 6l9 3v6l-9 3z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 9h9v6h-9z" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/>`,
  // two linked chain rings
  "tool:hyperlink": `<rect x="2.5" y="8" width="11" height="8" rx="4" fill="none" stroke="var(--g-ink)" stroke-width="1.8"/><rect x="10.5" y="8" width="11" height="8" rx="4" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.8"/>`,
  // a bulb hanging from a ceiling line
  "tool:incandescent": `<path d="M3 4h18" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><path d="M12 4v4" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M8.5 13.5a3.5 3.5 0 1 1 7 0c0 1.6-1 2.4-1.5 3.5h-4c-.5-1.1-1.5-1.9-1.5-3.5z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 20.5h4" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/>`,
  // a wall with waves of insulation in it
  "tool:insulation": `<rect x="3" y="4" width="18" height="16" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M5.5 8c1.6-2 3.1 2 4.6 0s3.1 2 4.6 0 3.1 2 4.6 0M5.5 13c1.6-2 3.1 2 4.6 0s3.1 2 4.6 0 3.1 2 4.6 0M5.5 18c1.6-2 3.1 2 4.6 0s3.1 2 4.6 0 3.1 2 4.6 0" fill="none" stroke="var(--g-hi)" stroke-width="1.6" stroke-linecap="round"/>`,
  // a room elevation: a wall with a panel, arrows pointing in from both sides
  "tool:intelev": `<rect x="7" y="4" width="10" height="16" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.4"/><rect x="9.5" y="8" width="5" height="8" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.2"/><path d="M2 12h3.5M22 12h-3.5" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><path d="M5 9.5l2.5 2.5L5 14.5z" fill="var(--g-ink)"/><path d="M19 9.5l-2.5 2.5 2.5 2.5z" fill="var(--g-ink)"/>`,
  // a round pipe with its two ends showing
  "tool:irrpipe": `<path d="M3 9h18v6H3z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><ellipse cx="3" cy="12" rx="1.6" ry="3" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.2"/><ellipse cx="21" cy="12" rx="1.6" ry="3" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.2"/>`,
  // a leader arrow pointing at a note box
  "tool:leaderline": `<path d="M4 20L13 11" fill="none" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><path d="M3.5 20.5l4.6-.9-3.7-3.7z" fill="var(--g-ink)" stroke="var(--g-ink)" stroke-width="1" stroke-linejoin="round"/><rect x="13" y="6" width="8" height="8" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M15.5 9.5h3.5M15.5 11.8h2.2" stroke="var(--g-ink)" stroke-width="1.4"/>`,
  // a leader line with a dot at the object and a short shelf at the note
  "tool:leadersimple": `<path d="M4 20L14 10h6" fill="none" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="20" r="2.2" fill="var(--g-pt)"/>`,
  // a line with its two end points
  "tool:line": `<path d="M5 19L19 5" fill="none" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><circle cx="5" cy="19" r="2" fill="var(--g-pt)"/><circle cx="19" cy="5" r="2" fill="var(--g-pt)"/>`,
  // a standing floor lamp: shade, pole and base
  "tool:light": `<path d="M7.5 4h9l3 7h-15z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 11v9" stroke="var(--g-ink)" stroke-width="1.6"/><path d="M7.5 21h9" stroke="var(--g-ink)" stroke-width="1.8" stroke-linecap="round"/>`,
  // a single point: a dot with four tick marks round it
  "tool:locus": `<path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke="var(--g-ink)" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3.2" fill="var(--g-pt)"/>`,
  // two cross-section rings joined by surfaces running between them
  "tool:loftsurface": `<ellipse cx="6.5" cy="17" rx="3.8" ry="2.6" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/><ellipse cx="17.5" cy="7" rx="3.8" ry="2.6" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M2.7 17L13.7 7M10.3 19.6L21.3 9.6" fill="none" stroke="var(--g-ink)" stroke-width="1.4"/>`,
  // a stepped massing block
  "tool:massingmodel": `<path d="M3 21V10h8V5h10v16z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M3 15h8M11 11h10" stroke="var(--g-ink)" stroke-width="1.2"/>`,
  // a tape reel with its tape running out and tick marks
  "tool:measure": `<circle cx="7.5" cy="11" r="4.8" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.5"/><circle cx="7.5" cy="11" r="1.5" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.1"/><path d="M12 9.5h9v3h-9z" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.3" stroke-linejoin="round"/><path d="M15 9.5v1.5M18 9.5v1.5M21 9.5v1.5" stroke="var(--g-ink)" stroke-width="1.2"/>`,
  // a shape and its mirror copy across a dotted axis
  "tool:mirror": `<path d="M3 19h7V5z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M21 19h-7V5z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 2.5v19" stroke="var(--g-ink)" stroke-width="1.1" stroke-dasharray="2.5 2"/>`,
  // a block with four-way arrows round it
  "tool:moveby": `<rect x="8" y="8" width="8" height="8" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M12 4.5v3.5M12 16v3.5M4.5 12H8M16 12h3.5" stroke="var(--g-ink)" stroke-width="1.5" stroke-linecap="round"/><path d="M12 1.5l2.4 3h-4.8zM12 22.5l2.4-3h-4.8zM1.5 12l3-2.4v4.8zM22.5 12l-3-2.4v4.8z" fill="var(--g-ink)"/>`,
  // a rectangle with a parallel copy drawn outside it
  "tool:offset": `<rect x="3.5" y="4.5" width="17" height="14" fill="none" stroke="var(--g-hi)" stroke-width="2.4"/><rect x="8" y="9" width="8" height="6" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/>`,
  // an ellipse with its centre point
  "tool:oval": `<ellipse cx="12" cy="12" rx="9" ry="6" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="var(--g-pt)"/>`,
  // an open hand
  "tool:pan": `<rect x="6" y="5.5" width="2.6" height="7.5" rx="1.3" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.3"/><rect x="8.6" y="4" width="2.6" height="9" rx="1.3" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.3"/><rect x="11.2" y="3.5" width="2.6" height="9.5" rx="1.3" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.3"/><rect x="13.8" y="5" width="2.6" height="8" rx="1.3" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.3"/><rect x="5.8" y="11" width="10.6" height="8.5" rx="3.2" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.4"/><rect x="2.6" y="9.6" width="3.2" height="6" rx="1.6" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.3" transform="rotate(25 4.2 12.6)"/>`,
  // a pipe run with an elbow and a flow arrow at its end
  "tool:pipingrun": `<path d="M4 4v10h10" fill="none" stroke="var(--g-ink)" stroke-width="6" stroke-linejoin="round"/><path d="M4 4v10h10" fill="none" stroke="var(--g-fill)" stroke-width="3.6" stroke-linejoin="round"/><path d="M15.5 11.5l4.5 2.5-4.5 2.5z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.2" stroke-linejoin="round"/>`,
  // a six-sided polygon, filled
  "tool:polygon": `<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.6" stroke-linejoin="round"/>`,
  // a line through several corners, each corner marked
  "tool:polyline": `<path d="M3 17l6-10 6 8 6-6" fill="none" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="3" cy="17" r="2" fill="var(--g-pt)"/><circle cx="9" cy="7" r="2" fill="var(--g-pt)"/><circle cx="15" cy="15" r="2" fill="var(--g-pt)"/><circle cx="21" cy="9" r="2" fill="var(--g-pt)"/>`,
  // a curve dropped down onto a flat plane
  "tool:project": `<path d="M3 18l5-3h13l-5 3z" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.3" stroke-linejoin="round"/><path d="M3 8c3-3 5-3 7 0s4 3 11 0" fill="none" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><path d="M8 11v3.5M14 12v2.5" stroke="var(--g-hi)" stroke-width="1.8" stroke-linecap="round"/>`,
  // a plot boundary drawn dotted, with its corners marked
  "tool:propline": `<path d="M4 7l6-3.5 10 3.5v11l-8 2.5L4 18z" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.6" stroke-linejoin="round" stroke-dasharray="3.5 2"/><circle cx="4" cy="7" r="1.9" fill="var(--g-pt)"/><circle cx="10" cy="3.5" r="1.9" fill="var(--g-pt)"/><circle cx="20" cy="7" r="1.9" fill="var(--g-pt)"/><circle cx="20" cy="18" r="1.9" fill="var(--g-pt)"/>`,
  // a half-circle with its degree ticks and an angle line
  "tool:protractor": `<path d="M3 17a9 9 0 0 1 18 0z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 17l5.2-5.2" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><path d="M12 8v2M6 11.5l1.4 1.2M18 11.5l-1.4 1.2" stroke="var(--g-ink)" stroke-width="1.4" stroke-linecap="round"/><circle cx="12" cy="17" r="1.8" fill="var(--g-pt)"/>`,
  // a box with one side pushed out, and an arrow to show the push
  "tool:pushpull": `<path d="M3 10h11v10H3z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M14 10l4-3.5v10L14 20z" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.3" stroke-linejoin="round"/><path d="M18.8 13.2h2.4" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><path d="M20 10.8l2.6 2.4-2.6 2.4z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.2" stroke-linejoin="round"/>`,
  // a quarter circle with its two radius lines and centre point
  "tool:quarterarc": `<path d="M4 20V5a15 15 0 0 1 15 15z" fill="var(--g-hi)"/><path d="M4 5a15 15 0 0 1 15 15" fill="none" stroke="var(--g-ink)" stroke-width="1.8" stroke-linecap="round"/><path d="M4 20V5M4 20h15" stroke="var(--g-ink)" stroke-width="1.3"/><circle cx="4" cy="20" r="1.9" fill="var(--g-pt)"/>`,
  // a handrail on posts, with a bottom rail
  "tool:railing": `<rect x="3" y="6" width="18" height="2.6" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.3"/><path d="M6 8.6v10.4M12 8.6v10.4M18 8.6v10.4" stroke="var(--g-ink)" stroke-width="1.5"/><path d="M3 19.5h18" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/>`,
  // a sloped wedge on the ground
  "tool:ramp": `<path d="M3 19.5h18L3 8.5z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 8.5v11" stroke="var(--g-ink)" stroke-width="1.6"/>`,
  // a wall socket: a plate with two slots and a round earth hole
  "tool:receptacle": `<rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.5"/><path d="M8.5 8.5v3.5M15.5 8.5v3.5" stroke="var(--g-ink)" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="15.5" r="2" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.3"/>`,
  // a plain filled rectangle
  "tool:rect": `<rect x="3.5" y="6" width="17" height="12" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.6"/>`,
  // a scalloped revision cloud
  "tool:redline": `<path d="M5 9.2a3 3 0 0 1 3-3.6 3.5 3.5 0 0 1 6.1-1.2 3.2 3.2 0 0 1 4 3.1 3.2 3.2 0 0 1 .9 5.4 3.2 3.2 0 0 1-2.1 4.5 3.3 3.3 0 0 1-5 1.7 3.3 3.3 0 0 1-4.8-1.1A3 3 0 0 1 5 13.5 3 3 0 0 1 5 9.2z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/>`,
  // a dashed reference line with a round tag at its end
  "tool:refmarker": `<path d="M2.5 12h14" stroke="var(--g-ink)" stroke-width="1.6" stroke-dasharray="4 2.5"/><circle cx="19" cy="12" r="3" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4"/>`,
  // a pentagon inside a dotted circle: the circle sets its size
  "tool:regpoly": `<circle cx="12" cy="12" r="9" fill="none" stroke="var(--g-ink)" stroke-width="1.3" stroke-dasharray="3 2"/><path d="M12 4.5l7.1 5.2-2.7 8.6H7.6l-2.7-8.6z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/>`,
  // a block with a double arrow pulling its side out
  "tool:reshape": `<rect x="2.5" y="7" width="9" height="10" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M13 12h7.5" stroke="var(--g-ink)" stroke-width="1.7" stroke-linecap="round"/><path d="M11.5 12l2.8-2.6v5.2z" fill="var(--g-ink)"/><path d="M21.5 12l-2.8-2.6v5.2z" fill="var(--g-ink)"/>`,
  // a square turned by a curved arrow round it
  "tool:rotate": `<rect x="8" y="8" width="8" height="8" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M18.1 6.9A8 8 0 1 0 20 14" fill="none" stroke="var(--g-ink)" stroke-width="1.7" stroke-linecap="round"/><path d="M17.3 14.2h5.4L20 10.6z" fill="var(--g-ink)"/>`,
  // a dashed cut line with a marker at each end
  "tool:secline": `<path d="M3 12h18" stroke="var(--g-ink)" stroke-width="1.6" stroke-dasharray="5 2.5"/><path d="M2.5 8.5h5L5 4.5z" fill="var(--g-ink)"/><path d="M16.5 15.5h5L19 19.5z" fill="var(--g-ink)"/>`,
  // a round marker with a downward triangle inside it
  "tool:secmarker": `<circle cx="12" cy="12" r="8.8" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.5"/><path d="M6.8 9.2h10.4L12 15.6z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.3" stroke-linejoin="round"/>`,
  // a pointer arrow
  "tool:select": `<path d="M6 3.5V19l4.2-4 2.8 6 2.4-1.1-2.8-5.9H16z" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/>`,
  // two matching small shapes, with a pointer arrow below them
  "tool:selectsimilar": `<rect x="2.5" y="2.5" width="6" height="6" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4"/><rect x="15.5" y="2.5" width="6" height="6" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4"/><g transform="translate(8 8) scale(0.6)"><path d="M6 3.5V19l4.2-4 2.8 6 2.4-1.1-2.8-5.9H16z" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="2.5" stroke-linejoin="round"/></g>`,
  // a block leaning sideways into a slanted parallelogram, with arrows along the top and bottom
  "tool:shear": `<path d="M7 7h13l-4 10H3z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M3.5 3.5h13" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><path d="M20.5 3.5l-3-2.2v4.4z" fill="var(--g-ink)"/><path d="M5 20.5h13" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><path d="M1.8 20.5l3.4-2.2v4.4z" fill="var(--g-ink)"/>`,
  // a solid block with a hollow inside
  "tool:shellsolid": `<rect x="3" y="3" width="18" height="18" rx="2" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.5"/><rect x="7.5" y="7.5" width="9" height="9" rx="1" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.4"/>`,
  // a thick floor plate seen in perspective
  "tool:slab": `<path d="M3 11h13v5H3z" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M3 11l5-4h13l-5 4z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M16 11l5-4v5l-5 4z" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/>`,
  // a slope line on the ground with its angle marked
  "tool:slopedim": `<path d="M3 19.5h18" stroke="var(--g-ink)" stroke-width="1.6" stroke-linecap="round"/><path d="M3 19.5L19 7.5" stroke="var(--g-hi)" stroke-width="2.6" stroke-linecap="round"/><path d="M9 19.5a6 6 0 0 0-1.6-4.2" fill="none" stroke="var(--g-ink)" stroke-width="1.4"/><circle cx="3" cy="19.5" r="1.9" fill="var(--g-pt)"/>`,
  // a room outline with its label tag inside
  "tool:space": `<rect x="3.5" y="4" width="17" height="16" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.5"/><rect x="8" y="9.5" width="8" height="5" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.2"/>`,
  // two rooms side by side with a bold line between them
  "tool:spacelink": `<rect x="3" y="5" width="8" height="14" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/><rect x="11" y="5" width="10" height="14" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M11 5v14" stroke="var(--g-hi)" stroke-width="2.8"/>`,
  // a ball with an equator ring and a shine
  "tool:sphere": `<circle cx="12" cy="12" r="9" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.5"/><ellipse cx="12" cy="12" rx="9" ry="3" fill="none" stroke="var(--g-ink)" stroke-width="1.1"/><path d="M6.5 8.5a6.5 6.5 0 0 1 4-3" fill="none" stroke="var(--g-hi)" stroke-width="2" stroke-linecap="round"/>`,
  // one bar cut in two by a blade
  "tool:split": `<rect x="2.5" y="9" width="7.5" height="6" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/><rect x="14" y="9" width="7.5" height="6" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M12 4.5v15" stroke="var(--g-hi)" stroke-width="2.2" stroke-linecap="round"/>`,
  // a flight of steps rising to the right
  "tool:stair": `<path d="M3 20h18V5h-3v3h-3v3h-3v3H9v3H6v3H3z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/>`,
  // an I-beam seen end on
  "tool:structmember": `<rect x="3" y="4.5" width="18" height="3.5" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/><rect x="10" y="8" width="4" height="8" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.2"/><rect x="3" y="16" width="18" height="3.5" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/>`,
  // a wall switch plate with a lever
  "tool:switch": `<rect x="5.5" y="3" width="13" height="18" rx="2" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.5"/><rect x="9.5" y="6.5" width="5" height="6.5" rx="1.5" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.3"/><circle cx="12" cy="17" r="1.6" fill="var(--g-pt)"/>`,
  // a symbol in a dotted frame with a green plus for inserting it
  "tool:symbol": `<rect x="2.5" y="2.5" width="12" height="12" rx="1.5" fill="none" stroke="var(--g-ink)" stroke-width="1.3" stroke-dasharray="2.5 2"/><path d="M8.5 5l3.5 3.5-3.5 3.5L5 8.5z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><circle cx="17" cy="17" r="5" fill="var(--g-add)" stroke="var(--g-ink)" stroke-width="1.2"/><path d="M17 14.6v4.8M14.6 17h4.8" stroke="var(--g-paper)" stroke-width="1.6" stroke-linecap="round"/>`,
  // a box with one side sloped away, picked out in highlight
  "tool:taperface": `<path d="M3 10h13v10H3z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M3 10l4-3h14l-5 3z" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M16 10l5-3v10l-5 3z" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4" stroke-linejoin="round"/>`,
  // a capital A with a line under it
  "tool:text": `<path d="M4.5 19L12 4.5 19.5 19" fill="none" stroke="var(--g-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.8 14.2h8.4" stroke="var(--g-ink)" stroke-width="1.8" stroke-linecap="round"/><path d="M3 22h18" stroke="var(--g-hi)" stroke-width="2.2" stroke-linecap="round"/>`,
  // a cutting edge with the line on one side kept and the far end removed
  "tool:trim": `<path d="M14 3v18" stroke="var(--g-ink)" stroke-width="2" stroke-linecap="round"/><path d="M3 12h8.5" stroke="var(--g-ink)" stroke-width="1.7" stroke-linecap="round"/><path d="M16.5 12H21" stroke="var(--g-del)" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="2 2"/>`,
  // a flat truss: two chords with zigzag webs
  "tool:trussstraight": `<path d="M3 7h18M3 17h18" stroke="var(--g-ink)" stroke-width="2" stroke-linecap="round"/><path d="M3 17l4.5-10 4.5 10 4.5-10 4.5 10" fill="none" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/>`,
  // a bow-tie valve with its stem and handwheel
  "tool:valve": `<path d="M3 7v10l9-5z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/><path d="M21 7v10l-9-5z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 12V5.5" stroke="var(--g-ink)" stroke-width="1.6"/><path d="M8.5 5h7" stroke="var(--g-hi)" stroke-width="2.4" stroke-linecap="round"/>`,
  // an eye with its iris
  "tool:visibility": `<path d="M2.5 12C5 7.6 8.2 5.5 12 5.5s7 2.1 9.5 6.5c-2.5 4.4-5.7 6.5-9.5 6.5S5 16.4 2.5 12z" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.4" fill="var(--g-hi)" stroke="var(--g-ink)" stroke-width="1.4"/>`,
  // a person taking a step
  "tool:walkthrough": `<circle cx="12" cy="5" r="2.4" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.4"/><path d="M12 9v6" stroke="var(--g-ink)" stroke-width="2.2" stroke-linecap="round"/><path d="M8 11.5l4-1.2 4 1.6" fill="none" stroke="var(--g-ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15l-3 6M12 15l3.2 6" stroke="var(--g-ink)" stroke-width="2" stroke-linecap="round"/>`,
  // a wall section: a thick band with joints
  "tool:wall": `<rect x="3" y="8.5" width="18" height="7" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.5"/><path d="M8 8.5v3.5M16 12v3.5" stroke="var(--g-ink)" stroke-width="1.2"/>`,
  // the corner where two walls meet, with a dot at the open end
  "tool:walljoin": `<path d="M3 21V4h17v4H7v13z" fill="var(--g-fill)" stroke="var(--g-ink)" stroke-width="1.5" stroke-linejoin="round"/><circle cx="20" cy="6" r="2" fill="var(--g-pt)"/>`,
  // a window: a frame with two panes divided by a cross
  "tool:window": `<rect x="3" y="4" width="18" height="16" fill="var(--g-fill2)" stroke="var(--g-ink)" stroke-width="1.5"/><rect x="5.5" y="6.5" width="13" height="11" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.2"/><path d="M12 6.5v11M5.5 12h13" stroke="var(--g-ink)" stroke-width="1.2"/>`,
  // a magnifier with a plus in its lens
  "tool:zoom": `<circle cx="10.5" cy="10.5" r="6.5" fill="var(--g-paper)" stroke="var(--g-ink)" stroke-width="1.8"/><path d="M15.5 15.5L21 21" stroke="var(--g-ink)" stroke-width="2.4" stroke-linecap="round"/><path d="M10.5 7.5v6M7.5 10.5h6" stroke="var(--g-add)" stroke-width="1.8" stroke-linecap="round"/>`,
};
