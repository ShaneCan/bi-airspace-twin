/**
 * *********************************************************************************************************************
 * Bigraph XMI Parser Functions
 * *********************************************************************************************************************
 */

/**
 * Parse a bigraph XMI file (i.e., a bigrid) containing potentially multiple roots.
 *
 * This function handles multi-root XMI models, where each root may
 * represent a distinct product of BiGridFactory elements. The XML is
 * parsed and normalized into a common data structure used by the
 * rendering pipeline.
 *
 * The argument `coordinatesAsLinks` indicates whether to use the outer names or CO-typed nodes to extract the
 * coordinates encoded in a Locale.
 *
 * @param {string} xmlString XMI source as a string.
 * @param {boolean} [coordinatesAsLinks=true] - Interpret coordinates as link edges.
 * @returns {Object} Parsed bigraph model (cells, links).
 */
export function parseBigraphXML(xmlString, coordinatesAsLinks = true) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");

    const nsResolver = (prefix) => {
        const ns = {
            bigraphBaseModel: "http://org.bigraphs.model",
            xmi: "http://www.omg.org/XMI",
            xsi: "http://www.w3.org/2001/XMLSchema-instance"
        };
        return ns[prefix] || null;
    };

    // XPath to select all <bRoots> elements (note: they are unprefixed)
    const xpathExpr = "//*[local-name()='bRoots']";
    const bRootsResult = xmlDoc.evaluate(xpathExpr, xmlDoc, nsResolver, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    console.log("bRootsResult", bRootsResult)
    const outerNamesResult = xmlDoc.evaluate("//*[local-name()='bOuterNames']", xmlDoc, nsResolver, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    console.log("outerNamesResult", outerNamesResult);

    const outerNames = [];
    for (let i = 0; i < outerNamesResult.snapshotLength; i++) {
        const outerNameElement = outerNamesResult.snapshotItem(i);
        const name = outerNameElement.getAttribute("name");
        outerNames.push(name);
    }
    console.log("outerNames", outerNames);
    const cells = [];
    let localeRootIndex = 0;
    // Now extract each bChild of type "bigraphBaseModel:Locale" and its corresponding bPorts
    for (let i = 0; i < bRootsResult.snapshotLength; i++) {
        const bRoot = bRootsResult.snapshotItem(i);

        // Find all bChild elements inside the current bRoot
        const bChildren = bRoot.getElementsByTagNameNS("", "bChild");


        const bChild = bChildren[0];
        // Check if this bChild is a Locale type (xsi:type="bigraphBaseModel:Locale")
        const xsiType = bChild.getAttribute("xsi:type");
        if (xsiType && xsiType.includes("bigraphBaseModel:Locale")) {
            const locName = bChild.getAttribute("name");

            // const res = extractLocalePortPoint(bChild, outerNames, /* preferredIndex: */ 4, parseParamControl);
            // if (res) {
            //     // console.log(
            //     //     `Locale: ${locName}, OuterName[${res.index}]="${res.outerName}", portIndex=${res.portIndex}, bLink="${res.bLink}", X,Y=[${res.point.x} | ${res.point.y}]`
            //     // );
            //     cells.push({index: res.index, locale: locName, point: res.point});
            // }


            // use outernames to retrieve coordinates
            if (coordinatesAsLinks === true) {
                // Now find all bPorts for this Locale
                const res = extractLocalePortPoint(bChild, outerNames, /* preferredIndex: */ 4, parseParamControl);
                if (res) {
                    // console.log(
                    //     `Locale: ${locName}, OuterName[${res.index}]="${res.outerName}", portIndex=${res.portIndex}, bLink="${res.bLink}", X,Y=[${res.point.x} | ${res.point.y}]`
                    // );
                    cells.push({index: res.index, locale: locName, point: res.point});
                }
            }
            const bCoordChild = bChild.getElementsByTagNameNS("", "bChild");
            for (let i = 0; i < bCoordChild.length; i++) {
                const bChildCoord = bCoordChild[i];
                const xsiTypePorts = bChildCoord.getAttribute("xsi:type");
                if (coordinatesAsLinks === false) {
                    if (xsiTypePorts && xsiTypePorts.includes("bigraphBaseModel:CO")) {
                        const coordNode = bChildCoord.getElementsByTagNameNS("", "bChild")[0];
                        const result = coordNode.getAttribute("xsi:type").split(":")[1];
                        const point = parseParamControl(result);
                        cells.push({
                            index: localeRootIndex++,
                            locale: locName,
                            point: point
                        });
                    }
                }
            }
        }
    }

    const linkMap = new Map();
    //TODO
    return {cells, linkMap};
}

/**
 *This parser handles a bigrid XMI encoding that has only a single root.
 *
 * It extracts cells and link information required by the rendering pipeline.
 *
 * The argument `coordinatesAsLinks` indicates whether to use the outer names or CO-typed nodes to extract the
 * coordinates encoded in a Locale.
 *
 * @param {string} xmlString - The XML source to parse.
 * @param {boolean} [coordinatesAsLinks=false] - Interpret coordinates as link edges.
 * @returns {{ cells: Array, linkMap: Object }} Parsed cell data and link structure
 */
export function parseBigraphXML_singleBRoot(xmlString, coordinatesAsLinks = false) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");

    const nsResolver = (prefix) => {
        const ns = {
            bigraphBaseModel: "http://org.bigraphs.model",
            xmi: "http://www.omg.org/XMI",
            xsi: "http://www.w3.org/2001/XMLSchema-instance"
        };
        return ns[prefix] || null;
    };

    // XPath to select all <bRoots> elements (note: they are unprefixed)
    const xpathExpr = "//*[local-name()='bRoots']";
    const bRootsResult = xmlDoc.evaluate(xpathExpr, xmlDoc, nsResolver, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    console.log("bRootsResult=", bRootsResult)

    const outerNamesResult = xmlDoc.evaluate("//*[local-name()='bOuterNames']", xmlDoc, nsResolver, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    console.log("outerNamesResult:", outerNamesResult);
    const outerNames = [];
    for (let i = 0; i < outerNamesResult.snapshotLength; i++) {
        const outerNameElement = outerNamesResult.snapshotItem(i);
        const name = outerNameElement.getAttribute("name");
        outerNames.push(name); // Store the name
    }
    console.log("outerNames:", outerNames);

    const cells = [];

    const bRoot = bRootsResult.snapshotItem(0);
    console.log("Single bRoot", bRoot);

    // Find all bChild elements inside the current bRoot
    const bChildren = bRoot.getElementsByTagNameNS("", "bChild");

    let localRootIndex = 0;
    let localeIndex = 0; // Track the index of locales in the XML
    
    for (let ix = 0; ix < bChildren.length; ix++) {
        const bChild = bChildren[ix];
        // Check if this bChild is a Locale type (xsi:type="bigraphBaseModel:Locale")
        const xsiType = bChild.getAttribute("xsi:type");
        if (xsiType && xsiType.includes("bigraphBaseModel:Locale")) {
            const locName = bChild.getAttribute("name");
            const bCoordChild = bChild.getElementsByTagNameNS("", "bChild");

            // use outer names to retrieve coordinates
            let pointFound = false;
            if (coordinatesAsLinks === true) {
                // For 3D bigrid, locales are created in order and outerNames are in the same order
                // So we can directly use the locale index to get the corresponding outerName
                if (localeIndex < outerNames.length) {
                    const outerName = outerNames[localeIndex];
                    try {
                        const point = parseParamControl(outerName);
                        cells.push({
                            index: localeIndex,
                            locale: locName,
                            point: point
                        });
                        pointFound = true;
                        localeIndex++;
                    } catch (e) {
                        console.warn(`Locale ${locName}: Failed to parse outerName at index ${localeIndex}: ${outerName}`, e);
                        // Fallback to port-based extraction
                        const res = extractLocalePortPoint(bChild, outerNames, /* preferredIndex: */ 4, parseParamControl);
                        if (res) {
                            cells.push({index: res.index, locale: locName, point: res.point});
                            pointFound = true;
                            localeIndex++;
                        }
                    }
                } else {
                    // Fallback to port-based extraction if index is out of range
                    const res = extractLocalePortPoint(bChild, outerNames, /* preferredIndex: */ 4, parseParamControl);
                    if (res) {
                        cells.push({index: res.index, locale: locName, point: res.point});
                        pointFound = true;
                        localeIndex++;
                    } else {
                        // Debug: log when extractLocalePortPoint fails
                        const bPorts = bChild.getElementsByTagNameNS("", "bPorts");
                        if (bPorts.length === 0) {
                            console.warn(`Locale ${locName} has no bPorts`);
                        } else {
                            console.warn(`Locale ${locName}: extractLocalePortPoint failed, ${bPorts.length} ports found`);
                        }
                    }
                }
            }
            
            // Fallback: try to extract from CO nodes if coordinatesAsLinks method failed
            if (!pointFound) {
                for (let i = 0; i < bCoordChild.length; i++) {
                    const bChildCoord = bCoordChild[i];
                    const xsiTypePorts = bChildCoord.getAttribute("xsi:type");
                    if (xsiTypePorts && xsiTypePorts.includes("bigraphBaseModel:CO")) {
                        const coordNode = bChildCoord.getElementsByTagNameNS("", "bChild")[0];
                        if (coordNode) {
                            try {
                                const result = coordNode.getAttribute("xsi:type").split(":")[1];
                                const point = parseParamControl(result);
                                cells.push({
                                    index: localRootIndex++,
                                    locale: locName,
                                    point: point
                                });
                                pointFound = true;
                                localeIndex++; // Increment even when using CO node fallback
                                break; // Found coordinate, no need to continue
                            } catch (e) {
                                console.warn(`Failed to parse coordinate for locale ${locName} from CO node:`, e);
                            }
                        }
                    }
                }
            }
            
            // Log warning if no coordinate was found
            if (!pointFound) {
                console.warn(`No coordinate found for locale: ${locName} at index ${localeIndex}`);
                // Don't increment localeIndex if we didn't find a coordinate
            }
        }
    }

    const linkMap = new Map();
    //TODO
    return {cells, linkMap};
}


/**
 * *********************************************************************************************************************
 * Helper Functions
 * *********************************************************************************************************************
 */

/**
 * Extract coordinate for 3D bigrid by trying all ports and finding unique coordinates.
 * This helps avoid duplicates when multiple locales share ports.
 */
function extractLocalePortPointFor3D(bChild, outerNames, localeName, parseParamControl) {
    const bPorts = bChild.getElementsByTagNameNS("", "bPorts");
    if (!bPorts || bPorts.length === 0) {
        return null;
    }

    const portsArray = Array.from(bPorts);
    const triedIndices = new Set();
    
    // Try all ports and collect valid coordinates
    const validPorts = [];
    for (let i = 0; i < portsArray.length; i++) {
        const port = portsArray[i];
        if (port.hasAttribute("bLink")) {
            const bLink = port.getAttribute("bLink") || "";
            const match = /bOuterNames\.(\d+)/.exec(bLink);
            if (match) {
                const idx = Number(match[1]);
                if (idx >= 0 && idx < outerNames.length && !triedIndices.has(idx)) {
                    const outerName = outerNames[idx];
                    if (outerName != null) {
                        try {
                            const point = parseParamControl(outerName);
                            validPorts.push({
                                index: idx,
                                point,
                                outerName,
                                bLink,
                                portIndex: i
                            });
                            triedIndices.add(idx);
                        } catch (e) {
                            // Continue to next port if parsing fails
                        }
                    }
                }
            }
        }
    }
    
    // If we found exactly one valid port, use it
    // Otherwise, prefer the one that matches the locale's expected pattern
    if (validPorts.length === 1) {
        return validPorts[0];
    } else if (validPorts.length > 1) {
        // For 3D bigrid, locale names are like "v{index2D}_L{layer}"
        // Try to find the port that matches the locale's position
        // Use the first valid port as fallback
        return validPorts[0];
    }
    
    return null;
}

/**
 * Extract outer-name index and point from a Locale's <bPorts>.
 * Falls back gracefully if the preferred index is missing.
 *
 * @param {Element} bChild - the <bChild xsi:type="bigraphBaseModel:Locale"> element
 * @param {string[]} outerNames - array of outer names (by index)
 * @param {number|null} preferredIndex - optional preferred port index (e.g. 4)
 * @param {(name:string)=>{x:number,y:number}} parseParamControl - your existing parser
 * @returns {{index:number, point:{x:number,y:number}, outerName:string, bLink:string, portIndex:number} | null}
 */
function extractLocalePortPoint(bChild, outerNames, preferredIndex = null, parseParamControl) {
    const bPorts = bChild.getElementsByTagNameNS("", "bPorts");
    if (!bPorts || bPorts.length === 0) {
        return null;
    }

    const localeName = bChild.getAttribute("name") || "unknown";
    const portsArray = Array.from(bPorts);
    
    // Try preferred index first if given
    if (preferredIndex != null && preferredIndex < portsArray.length) {
        const chosen = portsArray[preferredIndex];
        if (chosen.hasAttribute("bLink")) {
            const bLink = chosen.getAttribute("bLink") || "";
            const match = /bOuterNames\.(\d+)/.exec(bLink);
            if (match) {
                const idx = Number(match[1]);
                if (idx >= 0 && idx < outerNames.length) {
                    const outerName = outerNames[idx];
                    if (outerName != null) {
                        try {
                            const point = parseParamControl(outerName);
                            return {
                                index: idx,
                                point,
                                outerName,
                                bLink,
                                portIndex: preferredIndex
                            };
                        } catch (e) {
                            console.warn(`Locale ${localeName}: Failed to parse outerName at index ${idx}: ${outerName}`, e);
                        }
                    } else {
                        console.warn(`Locale ${localeName}: outerName at index ${idx} is null`);
                    }
                } else {
                    console.warn(`Locale ${localeName}: outerName index ${idx} out of range (0-${outerNames.length - 1})`);
                }
            }
        }
    }
    
    // If preferred index failed or not given, try all ports with bLink
    for (let i = 0; i < portsArray.length; i++) {
        const port = portsArray[i];
        // Skip if we already tried this port as preferredIndex
        if (preferredIndex != null && i === preferredIndex) continue;
        
        if (port.hasAttribute("bLink")) {
            const bLink = port.getAttribute("bLink") || "";
            const match = /bOuterNames\.(\d+)/.exec(bLink);
            if (match) {
                const idx = Number(match[1]);
                if (idx >= 0 && idx < outerNames.length) {
                    const outerName = outerNames[idx];
                    if (outerName != null) {
                        try {
                            const point = parseParamControl(outerName);
                            return {
                                index: idx,
                                point,
                                outerName,
                                bLink,
                                portIndex: i
                            };
                        } catch (e) {
                            // Continue to next port if parsing fails
                            console.warn(`Locale ${localeName}: Failed to parse outerName at index ${idx}: ${outerName}`, e);
                        }
                    }
                } else {
                    console.warn(`Locale ${localeName}: outerName index ${idx} out of range (0-${outerNames.length - 1})`);
                }
            }
        }
    }
    
    console.warn(`Locale ${localeName}: No valid coordinate found in ${portsArray.length} ports`);
    return null;
}

function parseParamControl(formattedString) {
    if (
        typeof formattedString !== "string" ||
        !formattedString.startsWith("C_") ||
        !formattedString.includes("__")
    ) {
        throw new Error("Invalid format");
    }

    try {
        const parts = formattedString.substring(2).split("__");

        const xString = parts[0].replace(/N/g, "-").replace(/_/g, ".");
        const yString = parts[1].replace(/N/g, "-").replace(/_/g, ".");
        
        const x = parseFloat(xString);
        const y = parseFloat(yString);
        
        // Check if z coordinate exists (3D format)
        let z = undefined;
        if (parts.length >= 3 && parts[2]) {
            const zString = parts[2].replace(/N/g, "-").replace(/_/g, ".");
            z = parseFloat(zString);
            if (isNaN(z)) {
                z = undefined;
            }
        }

        if (isNaN(x) || isNaN(y)) {
            throw new Error("Invalid number format");
        }

        // Return 2D or 3D point based on whether z exists
        if (z !== undefined) {
            return {x, y, z};
        } else {
            return {x, y};
        }
    } catch (e) {
        throw new Error("Invalid format: " + e.message);
    }
}