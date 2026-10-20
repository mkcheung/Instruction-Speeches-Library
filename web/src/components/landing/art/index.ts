/**
 * The landing page's illustrations, ported from the approved "Curtain Up"
 * mockup. The page lazy-loads this module, so the SVG markup and art.css
 * stay out of the main bundle. Wherever the others render, render
 * `<SceneDefs />` once as well: they all draw with its symbols.
 */
export { SceneDefs } from './SceneDefs'
export { StageLip } from './StageLip'
export { RehearsalScene } from './RehearsalScene'
export { FullHouseScene } from './FullHouseScene'
export { NoteAvatar } from './NoteAvatar'
