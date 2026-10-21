import type { ReactNode } from 'react'
import type { WorkspaceSceneId } from '../types'

const ink = '#2b211b'
const paper = '#fffdf6'

/** Deliberately simple paint primitives; each scene owns its posture and face. */
function Limb({ d, skin, width = 9 }: { d: string; skin: string; width?: number }) {
  return <>
    <path d={d} fill="none" stroke={ink} strokeWidth={width + 3} />
    <path d={d} fill="none" stroke={skin} strokeWidth={width} />
  </>
}

function Stage({ children }: { children: ReactNode }) {
  return <>
    <circle cx="92" cy="82" r="65" fill="#e9b949" fillOpacity=".38" stroke="none" />
    <path d="M6 14H23V99Q22 125 7 135Z" fill="#a81e28" />
    <path d="M178 14H161V99Q162 125 177 135Z" fill="#a81e28" />
    <path d="M13 17V111M171 17V111" stroke="#8a1720" />
    <path d="M12 160Q92 153 172 160" fill="none" stroke="#b9986b" />
    {children}
  </>
}

function Reviews() {
  return <g data-workspace-pose="seated-reading">
    <ellipse cx="94" cy="159" rx="47" ry="5" fill="#2b211b" opacity=".09" stroke="none" />
    <path d="M59 126H115V134H59ZM66 134L61 157M108 134L114 158" fill="#b88655" strokeWidth="3" />
    <path d="M76 120L60 135L64 150M98 121L112 135L108 151" fill="none" stroke="#2b211b" strokeWidth="14" />
    <path d="M76 120L60 135L64 150M98 121L112 135L108 151" fill="none" stroke="#53718a" strokeWidth="10" />
    <path d="M60 147Q45 152 52 158H69L70 150M104 149L105 158H123Q128 152 112 148" fill={ink} />
    <path d="M72 86Q84 79 101 87L110 119Q88 131 67 119Z" fill="#607d91" />
    <Limb d="M73 96L59 111L79 122" skin="#dfb78e" />
    <Limb d="M100 96L115 112L101 125" skin="#dfb78e" />
    <g transform="rotate(12 88 61)">
      <circle cx="61" cy="65" r="7" fill="#dfb78e" />
      <circle cx="117" cy="64" r="7" fill="#dfb78e" />
      <path d="M61 43Q64 24 88 25Q116 26 117 53L113 75Q103 92 84 88Q64 84 61 65Z" fill="#dfb78e" />
      <path d="M61 52Q55 28 75 23Q86 13 97 26Q119 22 118 47L105 42L95 36L79 43L67 42Z" fill="#6c6157" />
      <path d="M72 55L80 57M95 55L103 53" fill="none" />
      <path d="M74 64L78 65M96 64L100 65M88 63L86 70L91 71M86 79L96 80" fill="none" />
    </g>
    <g transform="rotate(8 88 121)">
      <path d="M62 110Q75 105 88 112Q102 106 114 112L111 136Q99 130 87 135Q74 129 62 133Z" fill={paper} />
      <path d="M88 113L87 134M68 116L80 118M68 122L79 123M96 117L108 116M96 123L106 122" fill="none" stroke="#8a7668" strokeWidth="1.4" />
    </g>
    <ellipse cx="72" cy="125" rx="5" ry="4" fill="#dfb78e" />
    <ellipse cx="108" cy="126" rx="5" ry="4" fill="#dfb78e" />
  </g>
}

function Speeches() {
  return <g data-workspace-pose="striding-film-carrier">
    <ellipse cx="96" cy="160" rx="51" ry="4" fill={ink} opacity=".09" stroke="none" />
    <path d="M84 115L69 137L50 148M101 116L113 137L128 148" fill="none" stroke={ink} strokeWidth="15" />
    <path d="M84 115L69 137L50 148M101 116L113 137L128 148" fill="none" stroke="#375e73" strokeWidth="11" />
    <path d="M48 143Q36 148 36 154L59 157L64 151ZM125 144L118 153L139 159Q150 156 140 151Z" fill={ink} />
    <path d="M78 82L104 78L121 112L83 125L66 97Z" fill="#d79f3d" />
    <Limb d="M76 91L60 109L82 117" skin="#a66b45" />
    <Limb d="M106 90L131 103L120 121" skin="#a66b45" />
    <g transform="rotate(-10 95 54)">
      <circle cx="66" cy="58" r="7" fill="#a66b45" />
      <path d="M67 34Q84 20 104 26Q122 33 121 58Q117 83 96 86Q73 83 67 67Z" fill="#a66b45" />
      <path d="M67 49Q55 31 72 22Q81 15 99 22Q119 16 123 36L122 48L109 39L95 44L80 36Z" fill="#25221f" />
      <circle cx="119" cy="21" r="12" fill="#25221f" />
      <path d="M79 48Q84 44 89 47M101 46Q107 42 112 46M80 56Q85 52 89 55M102 54Q107 50 111 54" fill="none" />
      <path d="M84 66L109 63Q108 79 97 78Q88 78 84 66Z" fill={paper} />
      <path d="M94 55L93 61L98 61" fill="none" />
    </g>
    <g transform="rotate(-8 105 112)">
      <rect x="79" y="95" width="47" height="16" rx="2" fill="#afc5c1" />
      <rect x="73" y="108" width="47" height="16" rx="2" fill="#f2d179" />
      <rect x="82" y="121" width="47" height="16" rx="2" fill="#d9bbc8" />
      <path d="M85 98V108M120 98V108M79 111V121M114 111V121M88 124V134M123 124V134" strokeDasharray="2 3" strokeWidth="4" />
    </g>
    <ellipse cx="76" cy="119" rx="5" ry="4" fill="#a66b45" />
    <ellipse cx="126" cy="123" rx="5" ry="4" fill="#a66b45" />
  </g>
}

function Reviewers() {
  return <g data-workspace-pose="greeting-and-laughing">
    <path d="M47 121L43 151M64 121L71 151M120 121L114 151M135 121L141 151" fill="none" stroke="#456b81" strokeWidth="10" />
    <path d="M38 150H51V157H32Q29 153 38 150ZM66 150H76L83 157H65ZM108 150H119V157H103ZM136 150H146L153 157H135Z" fill={ink} />
    <path d="M39 88Q51 81 66 86L75 122Q54 131 34 122Z" fill="#0f6b66" />
    <Limb d="M38 95L26 112L34 122" skin="#bd865c" width={7} />
    <Limb d="M68 95L87 98L96 83" skin="#bd865c" width={7} />
    <g transform="rotate(-12 54 63)">
      <path d="M29 48Q28 27 53 27Q76 26 80 49L77 71Q71 87 54 88Q34 86 29 67Z" fill="#bd865c" />
      <path d="M29 52Q20 33 37 27Q43 14 55 26Q81 23 80 49L65 41L52 47L43 39Z" fill="#443326" />
      <path d="M39 54L46 51M60 50L67 52" fill="none" />
      <circle cx="43" cy="61" r="1.5" fill={ink} /><circle cx="63" cy="59" r="1.5" fill={ink} />
      <path d="M46 70Q56 68 66 68Q63 81 55 79Q48 78 46 70Z" fill="#64392e" />
    </g>
    <path d="M109 88Q121 82 135 87L145 123Q123 130 105 122Z" fill="#b76c79" />
    <Limb d="M110 95L97 72L102 48" skin="#edc49c" width={7} />
    <Limb d="M136 96L151 111L142 122" skin="#edc49c" width={7} />
    <path d="M98 47L96 39M101 46L102 36M105 47L109 39" fill="none" stroke="#edc49c" strokeWidth="4" />
    <g transform="rotate(12 126 63)">
      <path d="M102 47Q101 28 123 28Q148 29 149 51L145 72Q138 87 124 87Q105 84 102 67Z" fill="#edc49c" />
      <path d="M102 52Q92 36 111 25Q131 17 147 34L149 49L135 41L125 47L115 40Z" fill="#9d573a" />
      <path d="M111 52Q115 49 119 51M130 51Q135 48 139 52M112 60Q116 64 120 60M131 60Q135 64 139 60" fill="none" />
      <path d="M115 71Q126 80 138 69" fill="none" strokeWidth="2.5" />
    </g>
    <path d="M88 32L84 26M93 29L94 22M88 38L80 38" fill="none" stroke="#8a1720" />
  </g>
}

function Upload() {
  return <g data-workspace-pose="slate-raised-overhead">
    <path d="M80 118L75 151M103 118L112 151" fill="none" stroke="#375c78" strokeWidth="12" />
    <path d="M69 149H80V158H60Q56 153 69 149ZM106 149H117L127 158H105Z" fill={ink} />
    <path d="M76 91Q91 84 107 91L115 123Q92 131 69 122Z" fill="#527da4" />
    <Limb d="M77 98L58 74L53 30" skin="#edbe94" />
    <Limb d="M106 98L125 72L131 29" skin="#edbe94" />
    <g transform="rotate(-8 91 67)">
      <path d="M63 54Q64 32 89 32Q115 34 119 55L114 79Q104 96 86 93Q65 89 63 74Z" fill="#edbe94" />
      <path d="M63 57Q54 39 73 30Q79 21 92 30Q109 22 119 43L118 55L103 48L90 50L79 45Z" fill="#b75c35" />
      <path d="M75 58L83 55M99 55L107 57" fill="none" />
      <ellipse cx="79" cy="65" rx="2" ry="3" fill={ink} /><ellipse cx="103" cy="64" rx="2" ry="3" fill={ink} />
      <path d="M82 76Q91 72 102 75Q101 89 92 89Q84 89 82 76Z" fill="#653b30" />
      <path d="M88 85Q93 82 98 85" fill="none" stroke="#df8f86" strokeWidth="3" />
    </g>
    <g transform="translate(0 3) rotate(-9 91 25)">
      <rect x="49" y="13" width="84" height="24" rx="3" fill={paper} />
      <path d="M49 13V7H133V13Z" fill={ink} />
      <path d="M60 8L56 12M79 8L75 12M98 8L94 12M117 8L113 12" stroke={paper} strokeWidth="4" />
      <path d="M63 23H117M73 29H107" stroke="#8a7668" strokeWidth="1.4" />
    </g>
    <ellipse cx="53" cy="31" rx="5" ry="4" fill="#edbe94" /><ellipse cx="131" cy="30" rx="5" ry="4" fill="#edbe94" />
  </g>
}

function Search() {
  return <g data-workspace-pose="crouching-detective">
    <path d="M79 119L58 136L67 150M99 121L118 140L136 147" fill="none" stroke={ink} strokeWidth="15" />
    <path d="M79 119L58 136L67 150M99 121L118 140L136 147" fill="none" stroke="#547083" strokeWidth="11" />
    <path d="M62 146L74 151L72 158H49Q46 153 62 146ZM133 143L144 149L149 156H124L125 150Z" fill={ink} />
    <path d="M68 83L95 80L112 116Q96 132 73 126L60 100Z" fill="#d9aa42" />
    <Limb d="M68 97L50 116L68 126" skin="#eac09c" />
    <Limb d="M100 95L118 102L107 94" skin="#eac09c" />
    <path d="M63 42Q39 43 43 82L58 102L69 86Z" fill="#743e30" />
    <g transform="rotate(19 87 63)">
      <path d="M61 46Q67 26 89 29Q112 31 118 49L115 74Q106 92 87 91Q66 89 61 72Z" fill="#eac09c" />
      <path d="M61 55Q52 35 74 25Q95 17 111 36L117 49L101 43L88 48L75 42Z" fill="#743e30" />
      <path d="M74 53L83 58M96 53L105 49" fill="none" />
      <path d="M75 64L82 65" fill="none" />
      <ellipse cx="103" cy="61" rx="2.5" ry="3.5" fill={ink} />
      <path d="M90 64L90 70L95 70" fill="none" />
      <ellipse cx="101" cy="80" rx="4" ry="5" fill="none" />
    </g>
    <path d="M91 76L110 99" stroke={ink} strokeWidth="7" />
    <circle cx="78" cy="62" r="18" fill="#d1e9e7" fillOpacity=".65" strokeWidth="3" />
    <path d="M68 56Q73 49 80 50" fill="none" stroke={paper} strokeWidth="3" />
    <ellipse cx="107" cy="94" rx="5" ry="4" fill="#eac09c" />
  </g>
}

function Profile() {
  return <g data-workspace-pose="winking-portrait" transform="rotate(-6 92 86)">
    <path d="M45 20H140V148H45Z" fill="#b88149" />
    <path d="M52 27H133V141H52Z" fill="#e9d7b8" />
    <path d="M60 139L66 112Q89 96 118 112L126 139Z" fill="#8a6c98" />
    <g transform="rotate(8 92 78)">
      <circle cx="61" cy="80" r="6" fill="#e6b78e" /><circle cx="123" cy="80" r="6" fill="#e6b78e" />
      <path d="M63 55Q68 38 91 38Q115 37 122 58L119 88Q110 108 90 106Q68 104 63 84Z" fill="#e6b78e" />
      <path d="M63 65Q56 43 79 36Q103 28 121 51L123 63L109 55L95 59L79 53Z" fill="#584235" />
      <path d="M75 67L83 65M101 66L111 62" fill="none" />
      <circle cx="79" cy="75" r="2" fill={ink} />
      <path d="M101 75Q106 80 112 74M86 88Q99 99 111 85" fill="none" />
      <path d="M92 76L90 83L95 84" fill="none" />
    </g>
    <path d="M70 151H115V160H70Z" fill={paper} />
    <path d="M80 155H105" stroke="#8a7668" />
  </g>
}

function Edit() {
  return <g data-workspace-pose="seated-pencil-concentration">
    <path d="M60 127H115V134H60M65 134V156M108 134L115 156" fill="#b88655" strokeWidth="3" />
    <path d="M77 123L59 141L66 152M98 122L116 139L110 153" fill="none" stroke="#3d556a" strokeWidth="12" />
    <path d="M61 149L72 152L71 159H49Q47 154 61 149ZM106 150L116 152L125 159H103Z" fill={ink} />
    <path d="M67 88Q85 80 103 88L113 122Q90 133 64 122Z" fill="#bd6d81" />
    <Limb d="M69 98L54 118L77 127" skin="#b67e55" />
    <Limb d="M103 97L120 110L112 125" skin="#b67e55" />
    <g transform="rotate(18 87 61)">
      <path d="M61 45Q65 24 87 25Q110 24 117 47L115 72Q108 91 88 90Q68 88 61 70Z" fill="#b67e55" />
      <path d="M61 53Q51 33 70 23Q85 15 103 23Q116 25 118 46L106 42L92 45L78 37Z" fill="#272526" />
      <circle cx="56" cy="43" r="12" fill="#272526" />
      <path d="M73 54L82 58M96 57L104 52M75 65L80 66M98 64L102 64M90 64L89 71L93 72M83 80L97 82" fill="none" />
      <path d="M91 81L97 82Q98 90 93 89Z" fill="#d98d87" strokeWidth="1.3" />
    </g>
    <g transform="rotate(-8 91 126)">
      <path d="M57 113H115L124 138H65Z" fill={paper} />
      <path d="M67 119H103M71 125H110M76 131H99" stroke="#8a7668" strokeWidth="1.3" />
    </g>
    <g transform="rotate(29 120 110)">
      <rect x="116" y="88" width="7" height="38" rx="1" fill="#e9b949" />
      <path d="M116 126L120 134L123 126Z" fill="#b88655" /><path d="M119 131L120 134L121 131" fill={ink} />
      <path d="M116 88V83H123V88Z" fill="#bd6d81" />
    </g>
    <ellipse cx="113" cy="119" rx="5" ry="4" fill="#b67e55" />
  </g>
}

function Account() {
  return <g data-workspace-pose="kneeling-locksmith">
    <path d="M72 117L51 139L61 151M86 123L96 145L82 152" fill="none" stroke={ink} strokeWidth="14" />
    <path d="M72 117L51 139L61 151M86 123L96 145L82 152" fill="none" stroke="#6a614f" strokeWidth="10" />
    <path d="M57 148L67 151V159H45Q42 154 57 148ZM80 148L90 153L87 160H70Q66 154 80 148Z" fill={ink} />
    <path d="M55 90Q69 81 89 88L102 118Q83 135 59 126L47 105Z" fill="#6c8052" />
    <Limb d="M57 98L49 119L81 128" skin="#edc69f" />
    <Limb d="M88 99L108 113L119 134" skin="#edc69f" />
    <g transform="rotate(16 70 65)">
      <circle cx="43" cy="68" r="7" fill="#edc69f" /><circle cx="97" cy="69" r="7" fill="#edc69f" />
      <path d="M43 46Q46 26 68 26Q93 25 99 48L95 76Q86 94 69 92Q50 90 43 73Z" fill="#edc69f" />
      <path d="M43 54Q35 34 53 25Q72 17 91 30L99 48L87 43L74 47L63 41Z" fill="#968775" />
      <path d="M54 56L61 54M77 54L85 55M53 65Q58 70 63 65M77 65Q82 70 87 65M68 65L67 72L72 73M61 80Q70 88 79 80" fill="none" />
    </g>
    <path d="M99 120Q127 111 153 123V156H99Z" fill="#bb844e" />
    <path d="M99 128H153M106 121V155M145 121V155" fill="none" stroke="#795236" />
    <path d="M119 134V130Q119 123 125 123Q132 123 132 130V134" fill="none" strokeWidth="3" />
    <rect x="117" y="133" width="18" height="17" rx="3" fill="#e9b949" />
    <path d="M126 140V144" strokeWidth="3" />
    <ellipse cx="116" cy="130" rx="5" ry="4" fill="#edc69f" />
  </g>
}

function Coach() {
  return <g data-workspace-pose="encouraging-lectern-gesture">
    <path d="M70 85Q90 75 111 87L118 119H64Z" fill="#8a6b98" />
    <Limb d="M73 94L52 78L49 55" skin="#aa704d" />
    <path d="M45 56L45 43Q45 38 49 40L52 54M51 54Q58 44 61 49L58 63L49 67Z" fill="#aa704d" />
    <Limb d="M108 94L130 103L123 114" skin="#aa704d" />
    <g transform="rotate(-11 92 55)">
      <path d="M65 40Q69 18 92 20Q117 20 121 43L116 70Q106 89 89 85Q69 82 65 63Z" fill="#aa704d" />
      <path d="M65 49Q56 29 75 19Q96 10 115 28L121 41L107 36L95 40L82 33Z" fill="#bdb0a0" />
      <path d="M75 44L83 42M101 42L109 45" fill="none" />
      <circle cx="80" cy="54" r="9" fill="none" /><circle cx="105" cy="54" r="9" fill="none" />
      <path d="M89 53H96M70 52L65 51M114 52L120 50" fill="none" />
      <circle cx="81" cy="54" r="1.5" fill={ink} /><circle cx="104" cy="54" r="1.5" fill={ink} />
      <path d="M80 67L105 65Q103 79 94 79Q84 79 80 67Z" fill={paper} />
      <path d="M77 71Q78 88 94 88Q110 86 112 70L106 75Q94 83 82 75Z" fill="#bdb0a0" />
    </g>
    <path d="M59 113H133L124 157H69Z" fill="#bd8a56" />
    <path d="M72 119H120L115 149H77Z" fill="#c99b6c" stroke="#9d6b3f" />
    <path d="M52 106H139V115H52Z" fill="#9d6b3f" />
    <path d="M119 106L123 88L115 83" fill="none" strokeWidth="3" />
    <ellipse cx="112" cy="82" rx="6" ry="3" fill={ink} transform="rotate(24 112 82)" />
    <ellipse cx="126" cy="107" rx="6" ry="4" fill="#aa704d" />
  </g>
}

function Welcome() {
  return <g data-workspace-pose="friendly-welcome-wave">
    <ellipse cx="178" cy="278" rx="112" ry="8" fill={ink} opacity=".08" stroke="none" />
    <circle cx="178" cy="137" r="112" fill="#e9b949" fillOpacity=".35" stroke="none" />
    <path d="M17 35H49V149Q47 184 20 195ZM343 35H311V149Q313 184 340 195Z" fill="#a81e28" />
    <path d="M30 40V157M330 40V157" stroke="#8a1720" strokeWidth="3" />
    <path d="M143 208L136 259M186 207L200 258" fill="none" stroke={ink} strokeWidth="21" />
    <path d="M143 208L136 259M186 207L200 258" fill="none" stroke="#456b81" strokeWidth="16" />
    <path d="M127 255H144V274H112Q103 267 127 255ZM192 255H207L224 274H191Z" fill={ink} />
    <path d="M134 145Q157 135 188 146L204 211Q169 228 124 211Z" fill="#0f6b66" />
    <Limb d="M133 159L105 191L128 207" skin="#dca377" width={13} />
    <Limb d="M190 158L225 139L235 98" skin="#dca377" width={13} />
    <path d="M230 100L227 82Q226 75 231 75L236 91L238 69Q239 62 244 66L244 89L250 72Q254 66 257 71L251 92L259 82Q263 79 266 84L256 105Q244 115 234 108Z" fill="#dca377" />
    <g transform="rotate(-8 163 97)">
      <circle cx="113" cy="100" r="11" fill="#dca377" /><circle cx="209" cy="100" r="11" fill="#dca377" />
      <path d="M114 72Q120 37 160 37Q203 36 211 72L205 113Q195 146 162 147Q125 145 115 115Z" fill="#dca377" />
      <path d="M114 84Q101 51 131 37Q144 18 163 36Q196 22 210 58L212 80L192 66L171 75L151 63L134 77Z" fill="#50372a" />
      <path d="M135 84Q142 79 150 81M175 81Q184 78 191 84" fill="none" strokeWidth="2.5" />
      <circle cx="143" cy="96" r="3" fill={ink} /><circle cx="183" cy="96" r="3" fill={ink} />
      <path d="M164 96L160 108L168 110" fill="none" />
      <path d="M145 120Q164 130 186 118Q180 138 164 138Q151 137 145 120Z" fill={paper} />
    </g>
    <path d="M79 73L68 66M83 61L79 49M92 55L94 44" fill="none" stroke="#8a1720" strokeWidth="3" />
    <path d="M68 278H289" stroke="#b9986b" />
  </g>
}

const scenes: Record<WorkspaceSceneId, () => ReactNode> = {
  reviews: Reviews, speeches: Speeches, reviewers: Reviewers, upload: Upload,
  search: Search, profile: Profile, edit: Edit, account: Account, coach: Coach, welcome: Welcome,
}

/** Independent decorative art chunk: no landing-art imports, shared IDs or assets. */
export default function WorkspaceArt({ scene }: { scene: WorkspaceSceneId }) {
  const Drawing = scenes[scene]
  const welcome = scene === 'welcome'
  return <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox={welcome ? '0 0 360 300' : '0 0 184 176'}
    width={welcome ? 360 : 184}
    height={welcome ? 300 : 176}
    aria-hidden="true"
    focusable="false"
    data-workspace-art={scene}
    style={{ display: 'block', width: '100%', height: '100%', pointerEvents: 'none' }}
    fill="none"
    stroke={ink}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {welcome ? <Drawing /> : <Stage><Drawing /></Stage>}
  </svg>
}
