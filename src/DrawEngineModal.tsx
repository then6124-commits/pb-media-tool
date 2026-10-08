import { useMemo, useState } from 'react'
import './draw_engine.css'

export type DrawEngineConfig = {
  handId: string
  handName: string
  styleId: string
  styleName: string
  drawSec: number
  holdSec: number
  pencilRatio: number
  colorMode: 'contour' | 'brush'
  strokePx: number
  bgPreset: 'transparent' | 'white' | 'cream' | 'black'
  bgColor: string
}

type HandCard = {
  id: string
  name: string
  badge: string
  badgeCls: 'gold' | 'blue'
  nib: string
  filter: 'nu' | 'nam' | 'pen' | 'drag'
  emoji: string
  alsoDrag?: boolean
}

type StyleCard = {
  id: string
  name: string
  tag: string
  desc: string
  swatch: string
}

const HANDS: HandCard[] = [
  { id: 'hide', name: 'Ẩn bàn tay / Chỉ vẽ nét', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(—)', filter: 'pen', emoji: '✒️' },
  { id: 'bare_long_fair_fineliner', name: 'Tay thon - Bút kim nét mảnh', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(181, 116)', filter: 'nu', emoji: '✒️' },
  { id: 'bare_place_light_push', name: 'Bàn tay - Đẩy vật thể nhẹ', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(290, 52)', filter: 'drag', emoji: '🖐️', alsoDrag: true },
  { id: 'calligraphy_brush_only', name: 'Bút lông thư pháp (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(12, 13)', filter: 'pen', emoji: '🖌️' },
  { id: 'charcoal_stick_only', name: 'Thỏi than phác thảo (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(12, 12)', filter: 'pen', emoji: '🖤' },
  { id: 'crayon_only_red', name: 'Bút sáp màu đỏ (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(148, 301)', filter: 'pen', emoji: '🖍️' },
  { id: 'female_fair_ballpoint_left', name: 'Tay nữ (Trái) - Bút bi', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(653, 117)', filter: 'nu', emoji: '🖊️' },
  { id: 'female_fair_brush_left', name: 'Tay nữ (Trái) - Cọ vẽ tranh', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(765, 92)', filter: 'nu', emoji: '🖌️' },
  { id: 'female_fair_crayon_right', name: 'Tay nữ (Phải) - Bút sáp màu', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(278, 140)', filter: 'nu', emoji: '🖍️' },
  { id: 'female_fair_fountain_right', name: 'Tay nữ (Phải) - Bút máy mực', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(294, 158)', filter: 'nu', emoji: '🖋️' },
  { id: 'female_fair_pencil_right', name: 'Tay nữ (Phải) - Bút chì gỗ', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(247, 136)', filter: 'nu', emoji: '✏️' },
  { id: 'female_fair_place_drag_left', name: 'Tay nữ (Trái) - Kéo thả hình', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(768, 85)', filter: 'nu', emoji: '👈', alsoDrag: true },
  { id: 'female_fair_place_openpalm_right', name: 'Tay nữ (Phải) - Xòe tay giới thiệu', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(239, 163)', filter: 'nu', emoji: '✋' },
  { id: 'female_fair_place_pinch_right', name: 'Tay nữ (Phải) - Nhúm ngón tay', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(319, 115)', filter: 'nu', emoji: '🤏', alsoDrag: true },
  { id: 'female_fair_place_slide_left', name: 'Tay nữ (Trái) - Trượt lướt đối tượng', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(654, 74)', filter: 'nu', emoji: '↔️', alsoDrag: true },
  { id: 'female_fair_place_twofinger_right', name: 'Tay nữ (Phải) - 2 ngón tay chỉ', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(301, 101)', filter: 'nu', emoji: '✌️' },
  { id: 'female_fair_stylus_left', name: 'Tay nữ (Trái) - Bút cảm ứng iPad', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(660, 90)', filter: 'nu', emoji: '📱' },
  { id: 'fountain_pen_only', name: 'Bút máy cao cấp (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(100, 143)', filter: 'pen', emoji: '🖋️' },
  { id: 'highlighter_only_yellow', name: 'Bút dạ quang vàng (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(13, 12)', filter: 'pen', emoji: '💛' },
  { id: 'male_fair_ballpoint_left', name: 'Tay nam (Trái) - Bút bi', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(736, 63)', filter: 'nam', emoji: '🖊️' },
  { id: 'male_fair_brush_left', name: 'Tay nam (Trái) - Cọ vẽ nghệ thuật', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(710, 61)', filter: 'nam', emoji: '🖌️' },
  { id: 'male_fair_crayon_right', name: 'Tay nam (Phải) - Bút sáp màu', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(193, 59)', filter: 'nam', emoji: '🖍️' },
  { id: 'male_fair_fineliner_right', name: 'Tay nam (Phải) - Bút kim kỹ thuật', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(199, 75)', filter: 'nam', emoji: '✒️' },
  { id: 'male_fair_fountain_right', name: 'Tay nam (Phải) - Bút máy', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(237, 96)', filter: 'nam', emoji: '🖋️' },
  { id: 'male_fair_pencil_right', name: 'Tay nam (Phải) - Bút chì phác thảo', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(298, 129)', filter: 'nam', emoji: '✏️' },
  { id: 'male_fair_place_drag_left', name: 'Tay nam (Trái) - Kéo thả đối tượng', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(736, 165)', filter: 'nam', emoji: '👈', alsoDrag: true },
  { id: 'male_fair_place_openpalm_right', name: 'Tay nam (Phải) - Bàn tay xòe', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(352, 68)', filter: 'nam', emoji: '✋' },
  { id: 'male_fair_place_pinch_right', name: 'Tay nam (Phải) - Nhúm giữ đối tượng', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(320, 65)', filter: 'nam', emoji: '🤏', alsoDrag: true },
  { id: 'male_fair_place_push_right', name: 'Tay nam (Phải) - Đẩy đối tượng', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(292, 131)', filter: 'nam', emoji: '🖐️', alsoDrag: true },
  { id: 'male_fair_place_slide_left', name: 'Tay nam (Trái) - Trượt đối tượng', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(726, 158)', filter: 'nam', emoji: '↔️' },
  { id: 'male_fair_place_twofinger_right', name: 'Tay nam (Phải) - 2 ngón chỉ', badge: 'Đẩy hình', badgeCls: 'gold', nib: '(385, 62)', filter: 'nam', emoji: '✌️' },
  { id: 'male_fair_stylus_left', name: 'Tay nam (Trái) - Bút vẽ Stylus', badge: 'Bút vẽ', badgeCls: 'gold', nib: '(788, 61)', filter: 'nam', emoji: '📱' },
  { id: 'marker_only_black', name: 'Bút lông bảng đen (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(200, 200)', filter: 'pen', emoji: '🖋️' },
  { id: 'mechanical_pencil_only', name: 'Bút chì kim cơ khí (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(12, 13)', filter: 'pen', emoji: '✏️' },
  { id: 'paintbrush_only', name: 'Cọ vẽ màu nước (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(113, 142)', filter: 'pen', emoji: '🖌️' },
  { id: 'palette_knife_only', name: 'Bay tán màu nghệ thuật (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(12, 13)', filter: 'pen', emoji: '🔪' },
  { id: 'pastel_stick_blue_only', name: 'Thỏi phấn màu xanh (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(12, 12)', filter: 'pen', emoji: '💙' },
  { id: 'pencil_only_wood', name: 'Bút chì gỗ vàng (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(165, 209)', filter: 'pen', emoji: '✏️' },
  { id: 'technical_fineliner_only', name: 'Bút kim kỹ sư (Chỉ bút)', badge: 'Chỉ bút', badgeCls: 'blue', nib: '(12, 12)', filter: 'pen', emoji: '✒️' },
]

const STYLES: StyleCard[] = [
  { id: 'whiteboard_stickman', name: 'Line Stickman', tag: 'Style whiteboard_stickman', desc: 'Thin, clean black line-art stick figures on a bright board.', swatch: 'linear-gradient(135deg,#f7f3ea,#e8e2d4)' },
  { id: 'pictogram_iso', name: 'Pictogram ISO', tag: 'Style pictogram_iso', desc: 'Solid dark silhouettes in a signage / ISO pictogram look.', swatch: 'linear-gradient(135deg,#1e293b,#334155)' },
  { id: 'continuous_line', name: 'Continuous Line', tag: 'Style continuous_line', desc: 'A single uninterrupted thin line for the whole scene.', swatch: 'linear-gradient(135deg,#f5e6d3,#b08968)' },
  { id: 'ikea_exploded_view', name: 'IKEA Exploded View', tag: 'Style ikea_exploded_view', desc: 'Technical manual-style drawings with assembly lines and arrows.', swatch: 'linear-gradient(135deg,#f8fafc,#94a3b8)' },
  { id: 'whiteboard_doodle_clean', name: 'Clean Whiteboard Doodle', tag: 'Style whiteboard_doodle_clean', desc: 'Playful black doodles with slightly thicker, controlled strokes.', swatch: 'linear-gradient(135deg,#fff,#e5e7eb)' },
  { id: 'whiteboard_flat_accent', name: 'Whiteboard Flat Accent', tag: 'Style whiteboard_flat_accent', desc: 'Clean black line art with a restrained three-color accent system.', swatch: 'linear-gradient(135deg,#ef4444,#3b82f6)' },
  { id: 'whiteboard_marker_bold', name: 'Bold Marker Whiteboard', tag: 'Style whiteboard_marker_bold', desc: 'Very thick, confident black marker strokes on whiteboard.', swatch: 'linear-gradient(135deg,#0f172a,#334155)' },
  { id: 'expressive_stickman', name: 'Expressive Stickman', tag: 'Style expressive_stickman', desc: 'Black line figures with motion symbols and expressive poses.', swatch: 'linear-gradient(135deg,#fef3c7,#fde68a)' },
  { id: 'stickman_colored_props', name: 'Stickman & Colored Props', tag: 'Style stickman_colored_props', desc: 'Monochrome figures contrasted with brightly colored story-critical props.', swatch: 'linear-gradient(135deg,#e0f2fe,#3b82f6)' },
  { id: 'ballpoint_notebook', name: 'Ballpoint Notebook', tag: 'Style ballpoint_notebook', desc: 'Everyday ballpoint pen on ruled notebook paper.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'blind_contour', name: 'Blind Contour', tag: 'Style blind_contour', desc: 'Continuous blind-contour drawing without lifting the pen.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'bold_outline_flat_color', name: 'Bold Outline Flat Color', tag: 'Style bold_outline_flat_color', desc: 'Heavy outlines filled with flat graphic color blocks.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'childlike_scribble', name: 'Childlike Scribble', tag: 'Style childlike_scribble', desc: 'Innocent, wobbly child-drawing scribble aesthetic.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'clean_ink_outline', name: 'Clean Ink Outline', tag: 'Style clean_ink_outline', desc: 'Crisp ink outlines with minimal shading.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'coloring_book_clean', name: 'Coloring Book Clean', tag: 'Style coloring_book_clean', desc: 'Open coloring-book pages ready for flat fills.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'concept_diagram_clean', name: 'Concept Diagram Clean', tag: 'Style concept_diagram_clean', desc: 'Clean concept / product diagram line work.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'cutaway_diagram_clean', name: 'Cutaway Diagram Clean', tag: 'Style cutaway_diagram_clean', desc: 'Technical cutaway diagram with labeled sections.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'dry_brush_ink', name: 'Dry Brush Ink', tag: 'Style dry_brush_ink', desc: 'Dry-brush ink texture with broken edges.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'editorial_line_art', name: 'Editorial Line Art', tag: 'Style editorial_line_art', desc: 'Magazine-style editorial line illustration.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'felt_tip_marker', name: 'Felt Tip Marker', tag: 'Style felt_tip_marker', desc: 'Saturated felt-tip marker look with soft bleed.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'flat_gouache', name: 'Flat Gouache', tag: 'Style flat_gouache', desc: 'Opaque gouache flats with soft painterly edges.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'geometric_flat_vector', name: 'Geometric Flat Vector', tag: 'Style geometric_flat_vector', desc: 'Geometric shapes assembled into flat vector scenes.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'midcentury_upa', name: 'Midcentury UPA', tag: 'Style midcentury_upa', desc: 'Mid-century UPA cartoon simplification.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'minimal_flat_vector', name: 'Minimal Flat Vector', tag: 'Style minimal_flat_vector', desc: 'Ultra-minimal flat vector icons and scenes.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'monoline_explainer', name: 'Monoline Explainer', tag: 'Style monoline_explainer', desc: 'Even monoline strokes for explainer graphics.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'naive_paper_collage', name: 'Naive Paper Collage', tag: 'Style naive_paper_collage', desc: 'Cut-paper collage with naive handmade charm.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'naive_wonky_illustration', name: 'Naive Wonky Illustration', tag: 'Style naive_wonky_illustration', desc: 'Wonky proportions and playful naive illustration.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'napkin_doodle', name: 'Napkin Doodle', tag: 'Style napkin_doodle', desc: 'Casual cafe-napkin sketch energy with loose imperfect lines.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'outline_icon_story', name: 'Outline Icon Story', tag: 'Style outline_icon_story', desc: 'Icon-outline storytelling frames.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'oversketched_pencil', name: 'Oversketched Pencil', tag: 'Style oversketched_pencil', desc: 'Layered oversketched pencil construction lines.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'pastel_flat_illustration', name: 'Pastel Flat Illustration', tag: 'Style pastel_flat_illustration', desc: 'Soft pastel palette flat illustration.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'quirky_editorial_character', name: 'Quirky Editorial Character', tag: 'Style quirky_editorial_character', desc: 'Quirky character design for editorial stories.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'retro_geometric_cartoon', name: 'Retro Geometric Cartoon', tag: 'Style retro_geometric_cartoon', desc: 'Retro geometric cartoon shapes and colors.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'rounded_flat_vector', name: 'Rounded Flat Vector', tag: 'Style rounded_flat_vector', desc: 'Friendly rounded flat vector forms.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'scratchy_ink', name: 'Scratchy Ink', tag: 'Style scratchy_ink', desc: 'Scratchy, nervous ink pen texture.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'simple_infographic_white', name: 'Simple Infographic White', tag: 'Style simple_infographic_white', desc: 'Simple white-background infographic figures.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'storyboard_marker', name: 'Storyboard Marker', tag: 'Style storyboard_marker', desc: 'Film storyboard marker frames.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'technical_explainer_line_art', name: 'Technical Explainer Line Art', tag: 'Style technical_explainer_line_art', desc: 'Precise technical explainer line art.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'thin_white_line_stickman', name: 'Thin White Line Stickman', tag: 'Style thin_white_line_stickman', desc: 'Delicate white stick figures designed for dark backgrounds.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'torn_paper_zine_collage', name: 'Torn Paper Zine Collage', tag: 'Style torn_paper_zine_collage', desc: 'Torn-paper zine collage aesthetic.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
  { id: 'wobbly_flat_fill', name: 'Wobbly Flat Fill', tag: 'Style wobbly_flat_fill', desc: 'Wobbly outlines with cheerful flat fills.', swatch: 'linear-gradient(135deg,#1e293b,#475569)' },
]

function handMatches(h: HandCard, filter: 'all' | 'nu' | 'nam' | 'pen' | 'drag') {
  if (filter === 'all') return true
  if (filter === 'nu') return h.id.startsWith('female_')
  if (filter === 'nam') return h.id.startsWith('male_')
  if (filter === 'pen') return h.filter === 'pen'
  if (filter === 'drag') return !!h.alsoDrag || h.filter === 'drag'
  return true
}

const FILTERS: { id: 'all' | 'nu' | 'nam' | 'pen' | 'drag'; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'nu', label: 'Tay Nữ' },
  { id: 'nam', label: 'Tay Nam' },
  { id: 'pen', label: 'Chỉ Bút' },
  { id: 'drag', label: 'Thao Tác Kéo Thả' },
]

const BG_PRESETS: { id: DrawEngineConfig['bgPreset']; label: string; sub: string; color: string }[] = [
  { id: 'transparent', label: 'Trong suốt', sub: 'Ghép video', color: 'transparent' },
  { id: 'white', label: 'Trắng', sub: 'Nền giấy trắng', color: '#ffffff' },
  { id: 'cream', label: 'Bảng kem', sub: 'Cổ điển sáng', color: '#F6F1E3' },
  { id: 'black', label: 'Bảng đen', sub: 'Hiệu ứng phấn', color: '#111111' },
]

export const DEFAULT_DRAW_CONFIG: DrawEngineConfig = {
  handId: 'bare_long_fair_fineliner',
  handName: 'Tay thon - Bút kim nét mảnh',
  styleId: 'whiteboard_stickman',
  styleName: 'Line Stickman',
  drawSec: 5,
  holdSec: 0,
  pencilRatio: 80,
  colorMode: 'contour',
  strokePx: 4,
  bgPreset: 'cream',
  bgColor: '#F6F1E3',
}

type TabId = 'hands' | 'styles' | 'dur' | 'stroke'

type Props = {
  open: boolean
  initial?: Partial<DrawEngineConfig>
  onClose: () => void
  onApply: (cfg: DrawEngineConfig) => void
}

export default function DrawEngineModal({ open, initial, onClose, onApply }: Props) {
  const seed = { ...DEFAULT_DRAW_CONFIG, ...initial }
  const [tab, setTab] = useState<TabId>('hands')
  const [filter, setFilter] = useState<'all' | 'nu' | 'nam' | 'pen' | 'drag'>('all')
  const [q, setQ] = useState('')
  const [handId, setHandId] = useState(seed.handId)
  const [styleId, setStyleId] = useState(seed.styleId)
  const [drawSec, setDrawSec] = useState(seed.drawSec)
  const [holdSec, setHoldSec] = useState(seed.holdSec)
  const [pencilRatio, setPencilRatio] = useState(seed.pencilRatio)
  const [colorMode, setColorMode] = useState<DrawEngineConfig['colorMode']>(seed.colorMode)
  const [strokePx, setStrokePx] = useState(seed.strokePx)
  const [bgPreset, setBgPreset] = useState<DrawEngineConfig['bgPreset']>(seed.bgPreset)
  const [bgColor, setBgColor] = useState(seed.bgColor)

  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: HANDS.length, nu: 0, nam: 0, pen: 0, drag: 0 }
    for (const h of HANDS) {
      if (handMatches(h, 'nu')) counts.nu++
      if (handMatches(h, 'nam')) counts.nam++
      if (handMatches(h, 'pen')) counts.pen++
      if (handMatches(h, 'drag')) counts.drag++
    }
    return counts
  }, [])

  const filtered = useMemo(() => {
    return HANDS.filter((h) => {
      if (!handMatches(h, filter)) return false
      if (q.trim() && !h.name.toLowerCase().includes(q.trim().toLowerCase())) return false
      return true
    })
  }, [filter, q])

  const handName = HANDS.find((h) => h.id === handId)?.name || handId
  const styleName = STYLES.find((s) => s.id === styleId)?.name || styleId

  if (!open) return null

  function reset() {
    const d = DEFAULT_DRAW_CONFIG
    setTab('hands')
    setFilter('all')
    setQ('')
    setHandId(d.handId)
    setStyleId(d.styleId)
    setDrawSec(d.drawSec)
    setHoldSec(d.holdSec)
    setPencilRatio(d.pencilRatio)
    setColorMode(d.colorMode)
    setStrokePx(d.strokePx)
    setBgPreset(d.bgPreset)
    setBgColor(d.bgColor)
  }

  function apply() {
    onApply({
      handId,
      handName,
      styleId,
      styleName,
      drawSec,
      holdSec,
      pencilRatio,
      colorMode,
      strokePx,
      bgPreset,
      bgColor,
    })
  }

  return (
    <div className="de-overlay" onClick={onClose} role="presentation">
      <div className="de-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="de-top">
          <div className="de-title-block">
            <div className="de-title-row">
              <span className="de-ico">✨</span>
              <h2>Studio Video Vẽ Tay</h2>
              <span className="de-badge">DRAW ENGINE 2.0</span>
            </div>
            <p className="de-sub">Thư viện {HANDS.length} mẫu bàn tay &amp; bút vẽ, {STYLES.length} phong cách vẽ và tùy chỉnh thời lượng</p>
          </div>
          <button type="button" className="de-x" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </header>

        <nav className="de-tabs">
          {(
            [
              ['hands', `✋ Bàn Tay & Bút Vẽ (${HANDS.length})`],
              ['styles', `🎨 Phong Cách Vẽ (${STYLES.length} Styles)`],
              ['dur', '⏱️ Thời Lượng & Động Lực'],
              ['stroke', '📐 Nét Vẽ & Màu Nền'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="de-body">
          {tab === 'hands' && (
            <>
              <div className="de-filters">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`de-chip ${filter === f.id ? 'on' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label} ({filterCounts[f.id] ?? 0})
                  </button>
                ))}
                <div className="de-search-wrap">
                  <span>🔍</span>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Tìm mẫu tay, bút..."
                  />
                </div>
              </div>
              <div className="de-hand-grid">
                {filtered.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className={`de-hand ${handId === h.id ? 'on' : ''}`}
                    onClick={() => setHandId(h.id)}
                  >
                    {handId === h.id && <span className="de-hand-check">✓</span>}
                    <span className={`de-hand-badge ${h.badgeCls}`}>{h.badge}</span>
                    <div className="de-hand-art">
                        {h.id !== 'hide' ? (
                          <img
                            src={`/draw/pens/${h.id}.png`}
                            alt=""
                            onError={(e) => {
                              const el = e.currentTarget as HTMLImageElement
                              el.style.display = 'none'
                              const sib = el.nextElementSibling as HTMLElement | null
                              if (sib) sib.style.display = 'block'
                            }}
                          />
                        ) : null}
                        <span className="de-hand-emoji" style={{ display: h.id === 'hide' ? 'block' : 'none' }}>{h.emoji}</span>
                      </div>
                    <div className="de-hand-name">{h.name}</div>
                    <div className="de-hand-nib">Ngòi: {h.nib}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'styles' && (
            <div className="de-style-grid">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`de-style ${styleId === s.id ? 'on' : ''}`}
                  onClick={() => setStyleId(s.id)}
                >
                  <div className="de-style-thumb" style={{ background: s.swatch }}>
                    <img
                      className="de-style-img"
                      src={`/draw/styles/${s.id}.webp`}
                      alt=""
                      onError={(e) => {
                        ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                      }}
                    />
                    <span className="de-style-tag-float">{s.tag}</span>
                    <span className="de-style-illus">🏡💧</span>
                  </div>
                  <div className="de-style-meta">
                    <div className="de-style-name">{s.name}</div>
                    <div className="de-style-desc">{s.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {tab === 'dur' && (
            <div className="de-dur">
              <div className="de-dur-row">
                <div className="de-field">
                  <div className="de-field-label">
                    Thời gian vẽ nét (Draw Duration): <b>{drawSec} giây</b>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    value={drawSec}
                    onChange={(e) => setDrawSec(Number(e.target.value))}
                  />
                  <div className="de-scale">
                    <span>1s (Siêu nhanh)</span>
                    <span>15s (Chuẩn)</span>
                    <span>30s (Chậm rãi)</span>
                  </div>
                </div>
                <div className="de-field">
                  <div className="de-field-label">
                    Giữ hình sau khi vẽ (Hold Duration): <b>{holdSec} giây</b>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={holdSec}
                    onChange={(e) => setHoldSec(Number(e.target.value))}
                  />
                  <div className="de-scale">
                    <span>0s (Chuyển ngay)</span>
                    <span>2s (Khuyên dùng)</span>
                    <span>10s (Dừng lâu)</span>
                  </div>
                </div>
              </div>
              <div className="de-dur-row">
                <div className="de-field">
                  <div className="de-ratio-labels">
                    <span className="green">Tỉ lệ nét chì phác thảo: {pencilRatio}%</span>
                    <span className="gold">Tô màu: {100 - pencilRatio}%</span>
                  </div>
                  <input
                    className="de-ratio"
                    type="range"
                    min={0}
                    max={100}
                    value={pencilRatio}
                    onChange={(e) => setPencilRatio(Number(e.target.value))}
                    style={{
                      background: `linear-gradient(90deg, #22c55e 0%, #22c55e ${pencilRatio}%, #374151 ${pencilRatio}%, #374151 100%)`,
                    }}
                  />
                </div>
                <div className="de-field">
                  <div className="de-field-label">Kiểu quét màu (Pha 2)</div>
                  <div className="de-seg">
                    <button
                      type="button"
                      className={colorMode === 'contour' ? 'on' : ''}
                      onClick={() => setColorMode('contour')}
                    >
                      ～ Quét loang (Contour)
                    </button>
                    <button
                      type="button"
                      className={colorMode === 'brush' ? 'on' : ''}
                      onClick={() => setColorMode('brush')}
                    >
                      🖌️ Cọ theo khối (Brush)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'stroke' && (
            <div className="de-stroke">
              <div className="de-stroke-row">
                <div className="de-field de-stroke-left">
                  <div className="de-field-label">
                    Độ dày nét bút (Stroke Width): <b>{strokePx} px</b>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={16}
                    step={1}
                    value={strokePx}
                    onChange={(e) => setStrokePx(Number(e.target.value))}
                  />
                  <div className="de-scale">
                    <span>1px (Siêu mảnh)</span>
                    <span>4px (Khuyên dùng)</span>
                    <span>16px (Nét đậm)</span>
                  </div>
                </div>

                <div className="de-field de-stroke-right">
                  <div className="de-field-label de-bg-head">
                    <span>Màu nền Video Canvas:</span>
                    <span className="de-bg-free-label">Chọn màu tự do:</span>
                    <label className={`de-color-pick ${bgPreset === 'transparent' ? 'is-transparent' : ''}`}>
                      {bgPreset === 'transparent' ? (
                        <>
                          <span className="de-swatch checker" />
                          <code>TRANSPARENT</code>
                        </>
                      ) : (
                        <>
                          <span className="de-swatch" style={{ background: bgColor }} />
                          <code>{(bgColor || '#F6F1E3').toUpperCase()}</code>
                        </>
                      )}
                      <input
                        type="color"
                        value={bgPreset === 'transparent' ? '#F6F1E3' : bgColor}
                        onChange={(e) => {
                          setBgColor(e.target.value)
                          setBgPreset('cream')
                        }}
                      />
                    </label>
                  </div>
                  <div className="de-bg-grid">
                    {BG_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`de-bg-card ${bgPreset === p.id ? 'on' : ''}`}
                        onClick={() => {
                          setBgPreset(p.id)
                          if (p.id === 'transparent') {
                            setBgColor('#F6F1E3')
                          } else {
                            setBgColor(p.color)
                          }
                        }}
                      >
                        <span
                          className={`de-bg-dot ${p.id}`}
                          style={p.id === 'transparent' ? undefined : { background: p.color }}
                        />
                        <span className="de-bg-label">{p.label}</span>
                        <span className="de-bg-sub">{p.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        <footer className="de-foot">
          <button type="button" className="de-btn ghost" onClick={reset}>
            Khôi phục mặc định
          </button>
          <div className="de-selected">
            Đã chọn: <b>{handName}</b>
          </div>
          <button type="button" className="de-btn gold" onClick={apply}>
            Xong &amp; Áp Dụng
          </button>
        </footer>
      </div>
    </div>
  )
}
