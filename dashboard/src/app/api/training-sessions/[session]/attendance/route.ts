import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

function toSpecificSlot(isoDate: string, hour: string): string {
  return `${isoDate} ${hour}hs`;
}

export const POST = withPermission('api', '/api/training-sessions/attendance', 'POST', async (sess, req) => {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const session = pathParts[pathParts.length - 2]; // YYYY-MM-DD-HH

    // Parse session format: YYYY-MM-DD-HH
    const parts = session.split('-');
    if (parts.length !== 4) {
      return new NextResponse("Invalid session format", { status: 400 });
    }

    const isoDate = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const hour = parts[3];
    const specificSlot = toSpecificSlot(isoDate, hour);

    const body = await req.json() as { player_id: string; attended: boolean };
    
    if (!body?.player_id || typeof body.attended !== 'boolean') {
      return new NextResponse("Missing fields", { status: 400 });
    }

    // Upsert attendance
    const { error } = await supabaseAdmin()
      .from("attendances")
      .upsert(
        { 
          session: specificSlot, 
          player_id: body.player_id, 
          attended: body.attended 
        },
        { onConflict: "session,player_id" }
      );

    if (error) {
      console.error(error);
      return new NextResponse("Error updating attendance", { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal server error", { status: 500 });
  }
});
