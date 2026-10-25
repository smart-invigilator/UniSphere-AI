
import math
import random

import pytest

from app.ai.face_scan import SECTOR_COUNT, FaceScanSession, ScanConfig, ScanStore, cos

from face_scan_sim import A, B, BASE, DIM, POSE_VEC, Sim, person 


def enroll_session(seed=0, **kw):
    return FaceScanSession(mode="enroll", cfg=ScanConfig(), rng=random.Random(seed), now=1.0, **kw)


@pytest.fixture(scope="module")
def enrolled():
    s = enroll_session(1)
    res = Sim(s, A, seed=1).run()
    assert res["status"] == "passed", res
    return s.result



def test_enrollment_completes_all_directions(enrolled):
    t = enrolled.templates
    assert sorted(r["sector"] for r in t["ring"]) == list(range(SECTOR_COUNT))
    assert len(t["front"]["embedding"]) == DIM
    assert enrolled.metrics["restarts"] == 0
    assert enrolled.best_front_jpeg == "JPEG"
    assert cos(enrolled.registration_embedding, A) > 0.9
    assert abs(cos(enrolled.registration_embedding, B)) < 0.3


def test_order_is_random_per_session():
    orders = set()
    for seed in range(12):
        s = enroll_session(seed)
        orders.add(tuple(st.sector for st in s.steps if st.kind == "ring"))
    assert len(orders) >= 8
    for o in orders:
        assert sorted(o) == list(range(8))   


def test_genuine_student_passes_verify(enrolled):
    s = FaceScanSession(mode="verify", templates=enrolled.templates, rng=random.Random(5), now=1.0)
    res = Sim(s, A, seed=77).run()
    assert res["status"] == "passed", (res, )
    assert s.result.metrics["sector_misses"] == 0


def test_legacy_single_photo_upgrade_passes_for_same_person():
    s = FaceScanSession(mode="upgrade", reference=A, rng=random.Random(2), now=1.0)
    res = Sim(s, A, seed=3).run()
    assert res["status"] == "passed"
    assert s.result.templates["ring"]



def test_impostor_is_rejected_at_login(enrolled):
    s = FaceScanSession(mode="verify", templates=enrolled.templates, rng=random.Random(5), now=1.0)
    res = Sim(s, B, seed=8).run()
    assert res["status"] == "failed" and res["code"] == "identity_mismatch"
    assert s.result is None


def test_impostor_rejected_for_legacy_account():
    s = FaceScanSession(mode="upgrade", reference=A, rng=random.Random(2), now=1.0)
    res = Sim(s, B, seed=3).run()
    assert res["status"] == "failed" and res["code"] == "identity_mismatch"


def test_person_swapped_after_front_check_in_verify_mode(enrolled):
    s = FaceScanSession(mode="verify", templates=enrolled.templates, rng=random.Random(5), now=1.0)
    sim = Sim(s, A, seed=4)
    for _ in range(40):
        if s.step_idx >= 3:
            break
        sim.send()
    assert s.step_idx >= 3 and s.phase == "running"
    sim.who = B
    res = sim.run()
    assert res["status"] == "failed" and res["code"] == "identity_mismatch"
    assert s.restarts >= 1
    assert s.result is None



def test_second_face_restarts_scan_and_discards_progress():
    s = enroll_session(3)
    sim = Sim(s, A, seed=5)
    while s.step_idx < 4:
        sim.send()
    res = sim.send(faces=2)
    assert res["code"] == "restart_multiple_faces"
    assert s.step_idx == 0 and s.restarts == 1
    assert res["restarts"] == 1
    res = sim.run()
    assert res["status"] == "passed"
    assert s.result.metrics["restarts"] == 1


def test_second_face_before_start_is_rejected_without_penalty():
    s = enroll_session(3)
    sim = Sim(s, A, seed=5)
    res = sim.send(faces=2)
    assert res["code"] == "multiple_faces" and s.restarts == 0


def test_repeated_second_face_aborts_scan():
    s = enroll_session(3)
    sim = Sim(s, A, seed=5)
    for _ in range(5):
        sim.send()
    last = None
    for _ in range(10):
        sim.send()
        last = sim.send(faces=2)
        if last["status"] != "running":
            break
    assert last["status"] == "failed" and last["code"] == "too_many_violations"



def test_short_dropout_is_tolerated():
    s = enroll_session(4)
    res = Sim(s, A, seed=6).run(events={8: dict(visible=False), 9: dict(visible=False)})
    assert res["status"] == "passed" and s.restarts == 0


def test_face_gone_too_long_restarts():
    s = enroll_session(4)
    sim = Sim(s, A, seed=6)
    for _ in range(8):
        sim.send()
    codes = [sim.send(visible=False)["code"] for _ in range(6)]
    assert "restart_face_lost" in codes
    assert s.restarts == 1 and s.step_idx == 0


def test_covered_eyes_blocks_frontal_frames_only():
    s = enroll_session(4)
    sim = Sim(s, A, seed=6)
    assert sim.send(quality="eyes_covered")["code"] == "quality"
    while s.steps[s.step_idx].kind == "front":
        sim.send()
    res = sim.send(quality="eyes_covered")
    assert res["code"] != "quality"


def test_blurry_frame_rejected_everywhere():
    s = enroll_session(4)
    sim = Sim(s, A, seed=6)
    while s.steps[s.step_idx].kind == "front":
        sim.send()
    assert sim.send(quality="face_low_sharpness")["code"] == "quality"


def test_swap_to_other_person_mid_scan_restarts_and_only_final_person_is_enrolled():
    s = enroll_session(6)
    sim = Sim(s, A, seed=9)
    while s.step_idx < 5:
        sim.send()
    sim.who = B
    res = sim.run()
    assert s.restarts >= 1
    assert res["status"] == "passed"
    assert cos(s.result.registration_embedding, B) > 0.9
    assert cos(s.result.registration_embedding, A) < 0.3
    for r in s.result.templates["ring"]:
        assert cos(r["embedding"], A) < 0.3


def test_fast_swap_between_two_frames_is_caught():
    s = enroll_session(6)
    sim = Sim(s, A, seed=9)
    while s.step_idx < 5:
        sim.send()
    sim.send(who=B)
    res = sim.send(who=B)
    assert res["code"] == "restart_identity_changed"


def test_single_glitchy_frame_does_not_kill_the_scan():
    s = enroll_session(6)
    sim = Sim(s, A, seed=9)
    res = sim.run(events={10: dict(who=B)})
    assert res["status"] == "passed" and s.restarts == 0

def test_static_face_never_passes():
    s = enroll_session(7)
    sim = Sim(s, A, seed=10)
    res = None
    for _ in range(200):
        res = sim.send(follow=False, yaw=BASE[0], pitch=BASE[1])
        if res["status"] != "running":
            break
    assert res["status"] == "failed" and res["code"] == "timeout"


def test_head_must_reach_each_direction_not_just_wiggle():
    s = enroll_session(7)
    sim = Sim(s, A, seed=10)
    while s.steps[s.step_idx].kind == "front":
        sim.send()
    for _ in range(20):                      
        res = sim.send(follow=False, yaw=BASE[0] + 5, pitch=BASE[1] + 3)
    assert res["code"] == "seek" and s.step_idx == 1


def test_recorded_sequence_replayed_in_other_order_fails():
    s1 = enroll_session(11)
    rec = Sim(s1, A, seed=11)
    poses = []
    while s1.phase == "running":
        rec.send()
        poses.append(tuple(rec.pose))
    s2 = enroll_session(12)
    assert [x.sector for x in s1.steps] != [x.sector for x in s2.steps]
    replay = Sim(s2, A, seed=11)
    res = None
    for (y, p) in poses:
        res = replay.send(follow=False, yaw=y, pitch=p)
        if res["status"] != "running":
            break
    assert s2.phase != "passed"


def test_scripted_instant_scan_is_rejected():
    s = enroll_session(13)
    sim = Sim(s, A, seed=1, dt=0.09)        
    res = sim.run()
    assert res["status"] == "failed" and res["code"] == "too_fast"


def test_frames_arriving_faster_than_allowed_are_ignored():
    s = enroll_session(13)
    sim = Sim(s, A, seed=1, dt=0.2)
    sim.send()
    sim.dt = 0.01
    assert sim.send()["code"] == "too_fast"
    assert s.frames == 1



@pytest.mark.parametrize("k", range(SECTOR_COUNT))
def test_sector_geometry(k):
    s = enroll_session(0)
    th = math.radians(45 * k)
    ux, uy = 1.1 * math.cos(th), 1.1 * math.sin(th)
    assert s._sector_hit(ux, uy, k)
    assert not s._sector_hit(-ux, -uy, k)
    assert not s._sector_hit(0.1 * ux, 0.1 * uy, k)          
    assert not s._sector_hit(ux, uy, (k + 2) % SECTOR_COUNT) 


def test_session_is_single_use_and_purpose_bound():
    store = ScanStore()
    s = enroll_session(1)
    Sim(s, A, seed=1).run()
    rec = store.create("register", s)
    assert store.consume(rec.id, "login") is None
    assert store.consume(rec.id, "register") is not None
    assert store.consume(rec.id, "register") is None


def test_unfinished_session_cannot_be_consumed():
    store = ScanStore()
    rec = store.create("register", enroll_session(1))
    assert store.consume(rec.id, "register") is None


def test_lockout_after_repeated_failures():
    store = ScanStore()
    for _ in range(4):
        store.record_failure(7)
    assert store.locked_for(7, 5, 600) == 0
    store.record_failure(7)
    assert store.locked_for(7, 5, 600) > 0
    assert store.locked_for(8, 5, 600) == 0
    store.clear_failures(7)
    assert store.locked_for(7, 5, 600) == 0


def test_store_capacity_limit():
    store = ScanStore(max_sessions=2)
    assert store.create("register", enroll_session(1))
    assert store.create("register", enroll_session(2))
    assert store.create("register", enroll_session(3)) is None
