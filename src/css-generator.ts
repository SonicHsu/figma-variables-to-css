export interface FigmaVariable {
  name: string;
  collection: string;
  type: string;
  value: string;
  isAlias: boolean;
  aliasName: string | null;
}

function toKebabCase(name: string): string {
  return name
    .replaceAll("/", "-")
    .replaceAll(/([a-z])([A-Z])/g, "$1-$2")
    .replaceAll(/[\s_]+/g, "-")
    .toLowerCase();
}

// Map Figma variable leaf names to CSS properties
const PROPERTY_MAP: Record<string, string> = {
  font: "font-family",
  "font-family": "font-family",
  weight: "font-weight",
  "font-weight": "font-weight",
  size: "font-size",
  "font-size": "font-size",
  "line-height": "line-height",
  "line height": "line-height",
  leading: "line-height",
  "letter-spacing": "letter-spacing",
  "letter spacing": "letter-spacing",
  tracking: "letter-spacing",
};

interface GroupedClass {
  className: string;
  properties: { cssProp: string; value: string }[];
}

/**
 * Detect variables that form groups (e.g. Typescale/CH > H1 > font, weight, size...)
 * A group is identified when multiple variables share the same parent path
 * and their leaf names map to known CSS properties.
 */
function detectGroups(variables: FigmaVariable[]): {
  groups: GroupedClass[];
  ungrouped: FigmaVariable[];
} {
  // Group by parent path (everything before the last `/`)
  const parentMap = new Map<string, FigmaVariable[]>();
  const ungrouped: FigmaVariable[] = [];

  for (const v of variables) {
    const lastSlash = v.name.lastIndexOf("/");
    if (lastSlash === -1) {
      ungrouped.push(v);
      continue;
    }

    const parentPath = v.name.substring(0, lastSlash);
    const leafName = v.name.substring(lastSlash + 1).toLowerCase().trim();
    const cssProp = PROPERTY_MAP[leafName];

    if (cssProp) {
      const list = parentMap.get(parentPath) ?? [];
      list.push(v);
      parentMap.set(parentPath, list);
    } else {
      ungrouped.push(v);
    }
  }

  const groups: GroupedClass[] = [];

  parentMap.forEach((vars, parentPath) => {
    // Only treat as a group if there are 2+ CSS properties
    if (vars.length < 2) {
      ungrouped.push(...vars);
      return;
    }

    const className = toKebabCase(parentPath);
    const properties = vars.map((v: FigmaVariable) => {
      const leafName = v.name.substring(v.name.lastIndexOf("/") + 1).toLowerCase().trim();
      const cssProp = PROPERTY_MAP[leafName];
      const value = v.isAlias
        ? `var(--${toKebabCase(v.aliasName ?? v.value)})`
        : formatValue(cssProp, v.value);
      return { cssProp, value };
    });

    groups.push({ className, properties });
  });

  return { groups, ungrouped };
}

function formatValue(cssProp: string, value: string): string {
  if (cssProp === "font-size" || cssProp === "line-height") {
    const num = Number.parseFloat(value);
    if (!Number.isNaN(num)) return `${num}px`;
  }
  if (cssProp === "letter-spacing") {
    const num = Number.parseFloat(value);
    if (!Number.isNaN(num)) return num === 0 ? "normal" : `${num}px`;
  }
  return value;
}

function generateRootVars(variables: FigmaVariable[]): string {
  if (variables.length === 0) return "";

  const lines = variables.map((v) => {
    const cssName = `--${toKebabCase(v.name)}`;
    const cssValue = v.isAlias
      ? `var(--${toKebabCase(v.aliasName ?? v.value)})`
      : v.value;
    return `  ${cssName}: ${cssValue};`;
  });

  return `:root {\n${lines.join("\n")}\n}`;
}

function generateClasses(groups: GroupedClass[]): string {
  return groups
    .map((g) => {
      const props = g.properties
        .map((p) => `  ${p.cssProp}: ${p.value};`)
        .join("\n");
      return `.${g.className} {\n${props}\n}`;
    })
    .join("\n\n");
}

export function generateCSS(variables: FigmaVariable[]): string {
  if (variables.length === 0) return "";

  const { groups, ungrouped } = detectGroups(variables);

  const parts: string[] = [];

  const rootVars = generateRootVars(ungrouped);
  if (rootVars) parts.push(rootVars);

  const classes = generateClasses(groups);
  if (classes) parts.push(classes);

  return parts.join("\n\n") + "\n";
}
