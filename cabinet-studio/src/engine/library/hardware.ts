// Hardware catalogue. Construction rules reference these by id; schedules and pricing
// are generated from the hardware the construction engine places.

export type HardwareType =
  | 'hinge'
  | 'hinge-plate'
  | 'runner'
  | 'handle'
  | 'leg'
  | 'shelf-pin'
  | 'fastener'
  | 'hanging-rail'
  | 'rail-support';

export interface HardwareDef {
  id: string;
  type: HardwareType;
  name: string;
  supplier?: string;
  code?: string;
}

export const HARDWARE: Record<string, HardwareDef> = {
  'hinge-110-softclose': { id: 'hinge-110-softclose', type: 'hinge', name: 'Concealed hinge 110°, soft close, full overlay' },
  'hinge-110-inset': { id: 'hinge-110-inset', type: 'hinge', name: 'Concealed hinge 110°, soft close, inset' },
  'hinge-bifold': { id: 'hinge-bifold', type: 'hinge', name: 'Bi-fold corner hinge 170° (door to door)' },
  'hinge-plate-0': { id: 'hinge-plate-0', type: 'hinge-plate', name: 'Hinge mounting plate, 0 mm' },
  'runner-ballbearing': { id: 'runner-ballbearing', type: 'runner', name: 'Ball-bearing runner pair, full extension, soft close' },
  'handle-bar-128': { id: 'handle-bar-128', type: 'handle', name: 'Bar handle 128 mm cc' },
  'handle-bar-160': { id: 'handle-bar-160', type: 'handle', name: 'Bar handle 160 mm cc' },
  'handle-bar-192': { id: 'handle-bar-192', type: 'handle', name: 'Bar handle 192 mm cc' },
  'handle-bar-320': { id: 'handle-bar-320', type: 'handle', name: 'Bar handle 320 mm cc' },
  'handle-knob': { id: 'handle-knob', type: 'handle', name: 'Round knob 30 mm' },
  'leg-adjustable': { id: 'leg-adjustable', type: 'leg', name: 'Adjustable cabinet leg 100–170 mm' },
  'shelf-pin-5': { id: 'shelf-pin-5', type: 'shelf-pin', name: 'Shelf support pin 5 mm' },
  'fastener-confirmat': { id: 'fastener-confirmat', type: 'fastener', name: 'Confirmat screw 7 × 50' },
  'fastener-dowel': { id: 'fastener-dowel', type: 'fastener', name: 'Fluted dowel 8 × 30 (glued)' },
  'fastener-cam': { id: 'fastener-cam', type: 'fastener', name: 'Cam & bolt connector 15 mm' },
  'fastener-rafix': { id: 'fastener-rafix', type: 'fastener', name: 'Rafix connector' },
  'fastener-screw': { id: 'fastener-screw', type: 'fastener', name: 'Chipboard screw 4 × 35' },
  'fastener-butt-glue': { id: 'fastener-butt-glue', type: 'fastener', name: 'Biscuit / glue joint' },
  'fastener-back-screw': { id: 'fastener-back-screw', type: 'fastener', name: 'Back panel screw 4 × 30' },
  'fastener-back-nail': { id: 'fastener-back-nail', type: 'fastener', name: 'Back panel staple / nail' },
  'hanging-rail-oval': { id: 'hanging-rail-oval', type: 'hanging-rail', name: 'Oval wardrobe tube 30 × 15' },
  'rail-support': { id: 'rail-support', type: 'rail-support', name: 'Wardrobe tube end support' },
};

export const HANDLE_LENGTHS: Record<string, number> = {
  'bar-128': 128,
  'bar-160': 160,
  'bar-192': 192,
  'bar-320': 320,
  knob: 0,
};
