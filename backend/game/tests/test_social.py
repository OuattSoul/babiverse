from game.models import Character, Friendship, SocialRequest

from .base import GameTestCase

TILE = 32


class SocialTests(GameTestCase):
    """Rencontres entre joueurs : présence, demandes, notifications, appels, discussions."""

    def setUp(self):
        super().setUp()
        self.other = self.new_player()
        self.create_character(self.other, name="Mariam")
        self.me_id = Character.objects.get(name="Kouadio").pk
        self.other_id = Character.objects.get(name="Mariam").pk

    def poll(self, client=None, zone="quartier", x=100, y=100, **extra):
        res = (client or self.client).post("/api/social/poll", {"pos": {"zone": zone, "x": x, "y": y}, **extra}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()

    def post(self, path, body, client=None, expect=200):
        res = (client or self.client).post(f"/api/social/{path}", body, format="json")
        self.assertEqual(res.status_code, expect, res.content)
        return res.json()

    def meet(self, dx=TILE * 2):
        """Les deux joueurs dans la ville, à `dx` pixels l'un de l'autre."""
        self.poll(x=100, y=100)
        self.poll(self.other, x=100 + dx, y=100)

    def ask(self, kind, client=None, to=None, expect=200, x=100, y=100):
        return self.post("request", {"to": to or self.other_id, "kind": kind, "pos": {"zone": "quartier", "x": x, "y": y}},
                         client=client, expect=expect)

    # --- Présence -------------------------------------------------------------------

    def test_players_in_the_same_shared_zone_see_each_other(self):
        self.meet()
        data = self.poll()
        self.assertEqual(data["me"], self.me_id)
        self.assertEqual([p["name"] for p in data["players"]], ["Mariam"])
        self.assertEqual(data["players"][0]["x"], 100 + TILE * 2)
        self.assertIn("appearance", data["players"][0])

    def test_home_and_private_interiors_are_not_shared(self):
        self.poll(zone="maison")
        self.poll(self.other, zone="maison")
        self.assertEqual(self.poll(zone="maison")["players"], [])

    def test_players_disappear_when_they_stop_polling(self):
        self.meet()
        self.advance(seconds=11)
        self.assertEqual(self.poll()["players"], [])

    # --- Demandes -------------------------------------------------------------------

    def test_request_needs_proximity(self):
        self.meet(dx=TILE * 8)
        self.assertEqual(self.ask("chat", expect=409)["error"]["code"], "too_far")
        self.meet(dx=TILE * 2)
        req = self.ask("chat")["request"]
        self.assertEqual((req["kind"], req["status"], req["direction"]), ("chat", "pending", "out"))

    def test_absent_player_cannot_be_asked(self):
        self.meet()
        self.advance(seconds=15)
        self.poll()
        self.assertEqual(self.ask("friend", expect=409)["error"]["code"], "not_available")

    def test_duplicate_request_returns_the_pending_one(self):
        self.meet()
        first = self.ask("friend")["request"]["id"]
        self.assertEqual(self.ask("friend")["request"]["id"], first)
        self.assertEqual(SocialRequest.objects.count(), 1)

    def test_unanswered_request_stays_as_read_notification(self):
        self.meet()
        req = self.ask("chat")["request"]["id"]
        data = self.poll(self.other, x=100 + TILE * 2)
        self.assertEqual(data["unread"], 1)
        note = data["notifications"][0]
        self.assertEqual((note["id"], note["direction"], note["status"], note["read"]), (req, "in", "pending", False))
        self.post("read", {"ids": [req]}, client=self.other)
        data = self.poll(self.other, x=100 + TILE * 2)
        self.assertEqual(data["unread"], 0)
        self.assertEqual((data["notifications"][0]["status"], data["notifications"][0]["read"]), ("pending", True))
        # Toujours possible d'y répondre plus tard.
        self.post("respond", {"id": req, "answer": "accept"}, client=self.other)

    def test_accepted_chat_opens_the_discussion(self):
        self.meet()
        self.assertEqual(self.post("message", {"to": self.other_id, "text": "Salut !"}, expect=403)["error"]["code"], "chat_closed")
        req = self.ask("chat")["request"]["id"]
        self.post("respond", {"id": req, "answer": "accept"}, client=self.other)
        mine = self.poll()
        self.assertEqual(mine["chats"], [self.other_id])
        self.assertEqual(mine["notifications"][0]["status"], "accepted")
        self.assertFalse(mine["notifications"][0]["read"])
        msg = self.post("message", {"to": self.other_id, "text": "  Salut Mariam !  "})["message"]
        self.assertEqual(msg["text"], "Salut Mariam !")
        theirs = self.poll(self.other, x=100 + TILE * 2)
        self.assertEqual([(m["text"], m["mine"], m["with"]) for m in theirs["messages"]], [("Salut Mariam !", False, self.me_id)])
        self.assertEqual(self.poll(self.other, after=msg["id"])["messages"], [])
        self.post("messages/read", {"with": self.me_id}, client=self.other)
        self.assertEqual(self.ask("chat", expect=409)["error"]["code"], "chat_open")

    def test_declined_request_informs_sender_and_blocks_immediate_retry(self):
        self.meet()
        req = self.ask("friend")["request"]["id"]
        self.post("respond", {"id": req, "answer": "decline"}, client=self.other)
        self.assertEqual(self.poll()["notifications"][0]["status"], "declined")
        self.assertEqual(self.ask("friend", expect=409)["error"]["code"], "too_soon")
        self.advance(seconds=121)
        self.meet()
        self.ask("friend")

    def test_friend_request_creates_friendship(self):
        self.meet()
        req = self.ask("friend")["request"]["id"]
        self.post("respond", {"id": req, "answer": "accept"}, client=self.other)
        self.assertEqual(Friendship.objects.count(), 1)
        data = self.poll()
        self.assertEqual([f["name"] for f in data["friends"]], ["Mariam"])
        self.assertTrue(data["players"][0]["friend"])
        self.assertEqual(self.ask("friend", expect=409)["error"]["code"], "already_friends")
        # Entre amis, la discussion est ouverte et la distance ne compte plus pour appeler.
        self.assertIn(self.other_id, data["chats"])
        self.meet(dx=TILE * 40)
        self.ask("call")
        self.post("unfriend", {"id": self.other_id})
        self.assertEqual(Friendship.objects.count(), 0)

    def test_cannot_answer_someone_elses_request(self):
        self.meet()
        req = self.ask("friend")["request"]["id"]
        self.post("respond", {"id": req, "answer": "accept"}, expect=404)

    # --- Appels ---------------------------------------------------------------------

    def test_unanswered_call_becomes_missed_after_30s_and_can_be_returned(self):
        self.meet()
        call = self.ask("call")["request"]
        self.assertIn("expires_at", call)
        ringing = self.poll(self.other, x=100 + TILE * 2)["call"]
        self.assertEqual((ringing["id"], ringing["role"], ringing["status"]), (call["id"], "callee", "pending"))
        self.advance(seconds=31)
        data = self.poll(self.other, x=100 + TILE * 2)
        self.assertIsNone(data["call"])
        note = data["notifications"][0]
        self.assertEqual((note["kind"], note["status"], note["read"]), ("call", "missed", False))
        self.assertEqual(self.post("respond", {"id": call["id"], "answer": "accept"}, client=self.other, expect=409)["error"]["code"],
                         "not_pending")
        # Rappeler, même loin : un appel a déjà eu lieu entre eux.
        self.poll(x=100 + TILE * 40)
        back = self.ask("call", client=self.other, to=self.me_id, x=100 + TILE * 2)["request"]
        self.assertEqual(back["status"], "pending")

    def test_accepted_call_relays_signals_then_hangs_up(self):
        self.meet()
        call = self.ask("call")["request"]["id"]
        self.assertEqual(self.ask("call", client=self.other, to=self.me_id, expect=409)["error"]["code"], "answer_first")
        self.post("respond", {"id": call, "answer": "accept"}, client=self.other)
        self.post("signal", {"id": call, "kind": "offer", "payload": {"type": "offer", "sdp": "v=0"}})
        self.post("signal", {"id": call, "kind": "nope", "payload": {}}, expect=400)
        theirs = self.poll(self.other, x=100 + TILE * 2)["call"]
        self.assertEqual((theirs["status"], theirs["role"]), ("accepted", "callee"))
        self.assertEqual([s["kind"] for s in theirs["signals"]], ["offer"])
        self.assertEqual(self.poll()["call"]["signals"], [])  # on ne reçoit pas ses propres messages
        after = theirs["signals"][-1]["id"]
        self.assertEqual(self.poll(self.other, signal_after=after)["call"]["signals"], [])
        self.post("hangup", {"id": call}, client=self.other)
        self.assertIsNone(self.poll()["call"])
        self.post("signal", {"id": call, "kind": "ice", "payload": {}}, expect=404)

    def test_call_ends_when_the_other_player_disappears(self):
        self.meet()
        call = self.ask("call")["request"]["id"]
        self.post("respond", {"id": call, "answer": "accept"}, client=self.other)
        self.advance(seconds=21)
        self.assertIsNone(self.poll()["call"])

    def test_caller_can_cancel_and_busy_players_are_refused(self):
        self.meet()
        call = self.ask("call")["request"]["id"]
        third = self.new_player()
        self.create_character(third, name="Ibrahim")
        self.poll(third, x=100, y=100 + TILE)
        ibrahim = Character.objects.get(name="Ibrahim").pk
        self.assertEqual(self.ask("call", client=third, expect=409)["error"]["code"], "busy")
        self.assertEqual(self.ask("call", to=ibrahim, expect=409)["error"]["code"], "busy")
        self.post("cancel", {"id": call})
        self.assertEqual(SocialRequest.objects.get(pk=call).status, "missed")
        self.ask("call", client=third)
