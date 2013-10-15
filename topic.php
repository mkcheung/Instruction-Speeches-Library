<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
// include_once("header.php");

class Topic extends DatabaseObject{

	protected static $tablename = "topics";
	protected static $attributes = array('id','category_id', 'description','topic_title','topic_creator','topic_date', 'isExample', 'video_id', 'video_name_1', 'video_size_1', 'video_type_1', 'video_temp_name_1', 'video_name_2', 'video_size_2', 'video_type_2', 'video_temp_name_2');

	public $id;
	public $category_id;
	public $description;
	public $topic_title;
	public $topic_creator;
	public $topic_date;
	public $isExample;
	public $video_id; // examine - added 10/13/2013 by MC
	public $video_name_1;
	public $video_size_1;
	public $video_type_1;
	public $video_temp_name_1;
	public $video_name_2;
	public $video_size_2;
	public $video_type_2;
	public $video_temp_name_2;

	public static function newTopic($categoryId, $description,$title, $creatorId, $isExample, $vidName1, $vidSize1, $vidType1, $vidTempName1, $vidName2, $vidSize2, $vidType2, $vidTempName2){
		global $db;

		$dateTime = new DateTime("now", new DateTimeZone('America/Los_Angeles'));
		$Object = new static;

		$Object->category_id = $categoryId;
		$Object->description = $description;
		$Object->topic_title = $title;
		$Object->topic_creator = $creatorId;
		$Object->topic_date = $dateTime->format("Y-m-d H:i:s");
		$Object->isExample = $isExample;
		$Object->video_name_1 = $vidName1;
		$Object->video_size_1 = $vidSize1;
		$Object->video_type_1 = $vidType1;
		$Object->video_temp_name_1 = $vidTempName1;
		$Object->video_name_2 = $vidName2;
		$Object->video_size_2 = $vidSize2;
		$Object->video_type_2 = $vidType2;
		$Object->video_temp_name_2 = $vidTempName2;

		return $Object;
	}

	public function topicTitle(){
		echo $this->topic_title;
	}

	public function find_by_category_id($cid){
		global $db;
		$sql = "SELECT * FROM " . static::$tablename . " WHERE category_id='" . $cid . "'" ;
		$result = $db->query($sql);
		while($row = mysql_fetch_array($result)){
			$object_array[] = static::instantiate($row);
		}
		return $object_array;

	}

}
?>
