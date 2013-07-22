<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
include_once("header.php");

class Post extends DatabaseObject{

	protected static $tablename = "posts";
	protected static $attributes = array('id', 'category_id', 'topic_id', 'post_creator', 'post_content', 'post_date');

	public $id;
	public $category_id;
	public $topic_id;
	public $post_creator;
	public $post_content;
	public $post_date;

	public static function newPost($cid, $top_id, $creatorId, $content, $dateOfPost=null){
		$Object = new static;
		$dateTime = new DateTime("now", new DateTimeZone("America/Los_Angeles"));

		$Object->category_id = $cid;
		$Object->topic_id = $top_id;
		$Object->post_creator = $creatorId;
		$Object->post_content = $content;
		$Object->post_date = $dateTime->format("Y-m-d H:i:s");

		return $Object;
	}

	public function find_posts_by_category_and_topic($cid, $tid){
		global $db;
		$sql = "SELECT * FROM " . static::$tablename . " WHERE category_id='" . $cid ."' AND topic_id='" . $tid . "' ORDER BY post_date ASC";
		$resultSet = $db->query($sql);
		while($row = mysql_fetch_assoc($resultSet)){
			$object_array[] = static::instantiate($row);
		}
		return $object_array;
	}

	public function find_number_of_posts($cid, $tid){
		global $db;
		$sql = "SELECT COUNT(*) as tot FROM " . static::$tablename . " WHERE category_id='" . $cid ."' AND topic_id='" . $tid . "'";
		$resultSet = $db->query($sql);
		$row = mysql_fetch_array($resultSet);
		return $row['tot'];
	}

}

?>