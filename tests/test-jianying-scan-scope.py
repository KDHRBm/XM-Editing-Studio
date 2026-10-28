"""Regression cases for the reported home-feature tiles being mistaken for drafts."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path('app/native/jianying').resolve()))
from draft_scan import locate_region, parse_cards, validate_queue


class ScopeTests(unittest.TestCase):
    def setUp(self):
        # Corresponds to the user's 2559 x 1390 home screenshot, independent of colored annotations.
        self.location = {'heading': {'text': '草稿 (15)', 'box': [486, 95, 507, 130]}, 'region': [515, 96, 630, 760]}
        self.scope = locate_region(json.dumps(self.location), (2559, 1390))

    def test_maps_cropped_coordinates_into_lower_draft_grid_at_original_resolution(self):
        cards = [{'kind': 'draft', 'name': f'错睡{i}', 'box': [10, x, 650, x+45]} for i, x in enumerate(range(0, 900, 60), 26)]
        drafts = parse_cards(json.dumps({'drafts': cards}), self.scope)
        self.assertEqual(len(drafts), 15)
        validate_queue(drafts, self.scope, (2559, 1390))
        self.assertTrue(all(y >= 716 for x, y, name in drafts))
        self.assertTrue(all(x >= 246 for x, y, name in drafts))

    def test_does_not_accept_folders_feature_section_or_project_names_as_headings(self):
        for label in ['文件夹 (1)', '专业升级', 'AI文字成片', '草稿导出工具', '一心求死草稿', 'New draft', '']:
            with self.subTest(label=label):
                data = {**self.location, 'heading': {**self.location['heading'], 'text': label}}
                with self.assertRaisesRegex(ValueError, '分区'):
                    locate_region(json.dumps(data), (2559, 1390))

    def test_region_overlapping_blue_feature_cards_or_folders_is_rejected(self):
        for region in [[200, 90, 800, 990], [480, 90, 800, 990], [515, 0, 800, 990], [515, 95, 800, 110]]:
            with self.subTest(region=region), self.assertRaises(ValueError):
                locate_region(json.dumps({**self.location, 'region': region}), (2559, 1390))

    def test_rejects_untrusted_or_missing_heading_and_old_fullscreen_array_schema(self):
        for text in ['null', '[]', '{"region":[0,0,1000,1000]}', '{bad json}']:
            with self.assertRaises(ValueError): locate_region(text, (2559, 1390))
        with self.assertRaises(ValueError): parse_cards('[{"box":[250,100,350,200],"name":"智能粗剪"}]', self.scope)

    def test_non_draft_candidates_never_enter_click_queue(self):
        cards = [{'kind': kind, 'name': 'excluded', 'box': [10, 10, 200, 80]} for kind in ['folder', 'feature', 'ad', 'template', None]]
        cards.append({'kind': 'draft', 'name': '错睡26', 'box': [10, 50, 650, 95]})
        drafts = parse_cards(json.dumps({'drafts': cards}), self.scope)
        self.assertEqual([name for x, y, name in drafts], ['错睡26'])

    def test_negative_fullscreen_or_invalid_coordinates_are_rejected(self):
        for box in [[-10, 10, 30, 30], [0, 0, 2000, 100], [10, 30, 5, 40], [True, 0, 100, 100], [0, 0, float('nan'), 100], [0, 0, float('inf'), 100]]:
            with self.subTest(box=box), self.assertRaises(ValueError):
                parse_cards(json.dumps({'drafts': [{'kind': 'draft', 'name': 'bad', 'box': box}]}), self.scope)

    def test_duplicate_positions_are_exported_only_once_and_count_overflow_is_rejected(self):
        card = {'kind': 'draft', 'name': '错睡26', 'box': [10, 10, 650, 55]}
        self.assertEqual(len(parse_cards(json.dumps({'drafts': [card, card]}), self.scope)), 1)
        scope = {**self.scope, 'count': 1}
        with self.assertRaisesRegex(ValueError, '数量'):
            parse_cards(json.dumps({'drafts': [card, {**card, 'box': [10, 80, 650, 125]}]}), scope)

    def test_queue_cannot_be_reused_without_scope_outside_region_or_after_resolution_change(self):
        for scope, drafts, screen in [(None, [(300, 780, '错睡26')], (2559, 1390)), (self.scope, [(300, 400, '智能粗剪')], (2559, 1390)), (self.scope, [(300, 780, '错睡26')], (1920, 1080))]:
            with self.assertRaises(ValueError): validate_queue(drafts, scope, screen)

    def test_localized_numbered_heading_and_json_fences_work(self):
        for label in ['草稿（15）', ' 草稿 ( 15 ) ', 'Drafts (15)']:
            data = {**self.location, 'heading': {**self.location['heading'], 'text': label}}
            self.assertEqual(locate_region('```json\n'+json.dumps(data)+'\n```', (2559, 1390))['count'], 15)

    def test_unnumbered_draft_heading_and_folder_breadcrumb_need_no_count(self):
        for label in ['草稿', '本地草稿', '我的草稿', '本地草稿 / 一心求死', '本地草稿／一心求死', 'Local drafts', 'Drafts / Season 1']:
            with self.subTest(label=label):
                data = {**self.location, 'heading': {**self.location['heading'], 'text': label}}
                scope = locate_region(json.dumps(data), (2559, 1390))
                self.assertIsNone(scope['count'])
                drafts = parse_cards('{"drafts":[{"kind":"draft","name":"一心求死2","bounds":{"left":18,"top":0,"right":175,"bottom":600}}]}', scope)
                self.assertEqual(len(drafts), 1)
                validate_queue(drafts, scope, (2559, 1390))
        data = {**self.location, 'heading': {**self.location['heading'], 'text': '本地草稿（15）'}}
        self.assertEqual(locate_region(json.dumps(data), (2559, 1390))['count'], 15)

    def test_reported_deepseek_width_as_right_edge_is_rejected_without_partial_queue(self):
        cards = [{'kind': 'draft', 'name': str(index), 'box': [0, x, 600, 175]} for index, x in enumerate([18, 135, 252, 370])]
        with self.assertRaisesRegex(ValueError, '第 3 个草稿.*left=252.*right=175'):
            parse_cards(json.dumps({'drafts': cards}), self.scope)

    def test_named_edges_and_legacy_arrays_map_to_identical_points(self):
        cards = [{'kind': 'draft', 'name': str(index), 'bounds': {'top': 0, 'left': x, 'bottom': 600, 'right': x+175}} for index, x in enumerate([18, 252, 486, 720])]
        drafts = parse_cards(json.dumps({'drafts': cards}), self.scope)
        legacy = [{k: v for k, v in card.items() if k != 'bounds'} | {'box': [0, card['bounds']['left'], 600, card['bounds']['right']]} for card in cards]
        self.assertEqual(drafts, parse_cards(json.dumps({'drafts': legacy}), self.scope))
        validate_queue(drafts, self.scope, (2559, 1390))
        self.assertEqual(len(drafts), 4)

    def test_invalid_named_edges_cannot_fall_back_to_legacy_box(self):
        for bounds in [None, [], {'left': 200, 'top': 0, 'right': 175, 'bottom': 600}, {'left': 0, 'top': 0, 'bottom': 600}, {'left': 0, 'top': 0, 'right': 2000, 'bottom': 600}]:
            with self.subTest(bounds=bounds), self.assertRaises(ValueError):
                parse_cards(json.dumps({'drafts': [{'kind': 'draft', 'name': 'invalid', 'bounds': bounds, 'box': [0, 0, 600, 175]}]}), self.scope)

    def test_reported_narrow_region_is_extended_to_the_visible_draft_canvas(self):
        location = {'heading': {'text': '本地草稿 / 一心求死', 'box': [313, 91, 331, 226]},
                    'region': [341, 92, 456, 456]}
        scope = locate_region(json.dumps(location, ensure_ascii=False), (2544, 1217))
        self.assertEqual(scope['box'][0], 235)
        self.assertEqual(scope['box'][1], 415)
        self.assertGreaterEqual(scope['box'][2], 2480)
        self.assertGreaterEqual(scope['box'][3], 1170)
        self.assertIsNone(scope['count'])

    def test_visible_count_catches_incomplete_answer_before_queue_replacement(self):
        incomplete = {'visibleCount': 13, 'drafts': [
            {'kind': 'draft', 'name': str(n), 'bounds': {'left': n*100, 'top': 0, 'right': n*100+90, 'bottom': 200}}
            for n in range(8)]}
        with self.assertRaisesRegex(ValueError, '模型计数 13.*有效坐标 8'):
            parse_cards(json.dumps(incomplete), self.scope)
        complete = {'visibleCount': 13, 'drafts': [
            {'kind': 'draft', 'name': str(n), 'bounds': {'left': (n%7)*130, 'top': (n//7)*350,
                                                     'right': (n%7)*130+100, 'bottom': (n//7)*350+300}}
            for n in range(13)]}
        self.assertEqual(len(parse_cards(json.dumps(complete), {**self.scope, 'count': None})), 13)

    def test_gemini_literal_newline_inside_json_string_is_normalized(self):
        location = json.dumps({'heading': {'text': '本地草稿 / 一心求死', 'box': [313, 91, 331, 226]},
                               'region': [341, 92, 456, 456]}, ensure_ascii=False).replace(' / ', ' / \n')
        scope = locate_region(location, (2544, 1217))
        cards = '{"visibleCount":1,"drafts":[{"kind":"draft","name":"一心求死\n01","bounds":{"left":10,"top":10,"right":100,"bottom":300}}]}'
        self.assertEqual(parse_cards(cards, scope)[0][2], '一心求死 01')
        with self.assertRaises(ValueError):
            locate_region(location.replace('\n', '\x00'), (2544, 1217))


if __name__ == '__main__': unittest.main()
