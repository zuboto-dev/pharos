import {
  BOARD_GUIDE,
  CATALOG,
  COMPONENT_INFO,
  OPTION_FIELDS,
  type ComponentName,
} from '@pharos/schema';
import { z } from 'zod';
import { PharosError } from '../store/errors.js';

const NAMES = Object.keys(COMPONENT_INFO) as ComponentName[];
const LAYOUT = new Set<ComponentName>(['Grid', 'Section', 'Tabs']);
const ANY_NODE = {
  type: 'object',
  description: 'Any catalog component node, e.g. {"component": "KanbanBoard"}; see catalog_list',
};

/** Compact overview of every component, plus the rules for boards and filters. */
export function catalogList() {
  return {
    board: BOARD_GUIDE,
    optionFields: Object.fromEntries(
      Object.entries(OPTION_FIELDS).map(([key, f]) => [key, `meanings: ${f.meanings.join(', ')}`]),
    ),
    components: NAMES.map((name) => ({
      name,
      category: COMPONENT_INFO[name].category,
      description: CATALOG[name].description,
      use: COMPONENT_INFO[name].use,
      minColumns: COMPONENT_INFO[name].minColumns,
      suggestedColumns: COMPONENT_INFO[name].suggestedColumns,
    })),
  };
}

/** Replaces the recursive child schemas of layout components with a short reference. */
function shallow(schema: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(schema);
  delete out.$defs;
  delete out.definitions;
  const props = out.properties as Record<string, Record<string, unknown>> | undefined;
  if (props?.children) props.children = { type: 'array', items: ANY_NODE };
  const tabItems = props?.tabs?.items as Record<string, unknown> | undefined;
  const tabProps = tabItems?.properties as Record<string, unknown> | undefined;
  if (tabProps?.children) tabProps.children = { type: 'array', items: ANY_NODE };
  return out;
}

/** Full details for some components: JSON Schema of their props, guidance, and an example. */
export function catalogDescribe(names: string[]) {
  const unknown = names.filter((n) => !(n in COMPONENT_INFO));
  if (unknown.length) {
    throw new PharosError(
      'invalid',
      `Unknown component${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`,
      [`Components: ${NAMES.join(', ')}`],
    );
  }
  return (names as ComponentName[]).map((name) => {
    let schema = z.toJSONSchema(CATALOG[name], { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
    if (LAYOUT.has(name)) schema = shallow(schema);
    delete schema.$schema;
    return { name, ...COMPONENT_INFO[name], description: CATALOG[name].description, schema };
  });
}
