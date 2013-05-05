<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("category.php");
require_once("topic.php");
require_once("function.php");
require_once("Session.php");
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
$category = Category::find_by_id($_GET['id']);
$topics = Topic::find_by_category_id($category->id);
?>

<div class="container-fluid">
	<div class="row-fluid">
	<div class="span2">
		<ul class="nav nav-list navMenu">
		 	<li class="nav-header">
		 		Navigation
		 	</li>
		 	<?php
				if($SESS->userRoleId == ADMIN_USER){
		 	?>
				<li>
					<a href="settings.php">Settings</a>
				</li>
				<li>
					<a href="uploadVideo.php">Upload Video</a>
				</li>
		 	<?php
		 		}
		 	?>
			<li class="dropdown">
				<a class="dropdown-toggle" id="speechDropDown" data-toggle="dropdown" href="#">
					Speech Categories <b class="caret"></b>
				</a>
				<ul id="speechDropDownMenu" class="dropdown-menu" role="menu" area-labelledby="speechDropDown">
					<?php
						if(!is_null($allCategories)){
							foreach($allCategories as $aCategory){
								echo "<li>";
								echo "<a tabindex=\"-1\" href=\"viewCategory.php?id=" . $aCategory->id . "\">" . $aCategory->category_title ."</a>";
								echo "</li>";	
							}
						} else{
							echo "<li>";
							echo "<a tabindex=\"-1\" href=\"#\">No Categories</a>";
							echo "</li>";
						}
					?>
				</ul>

			</li>
		</ul>
	</div>
	<div class="span10">
		<table class="table table-condensed">
			<thead>
				<tr>
					<td colspan="2"><?php echo $category->category_title . " speeches."; ?></td>
				</tr>
			</thead>
			<tbody>
				<?php
					foreach($topics as $topic){
						echo "<tr>";
							echo "<td>";
								echo "<div>";
									echo "<a href=\"viewTopicVideo.php?catId=". $topic->category_id . "&topId=" . $topic->id . "&vidId=" . $topic->video_id . "\">" . $topic->topic_title . "</a>";
								echo "</div>";
								echo "<div class=\"smallfont\">";
									echo "testing";
								echo "</div>";
							echo "</td>";
							echo "<td>";
							echo "<div class=\"smallfont\">";
								echo "Uploaded On:";
							echo "</div>"; 
							echo "<div class=\"smallfont\">";
								echo $topic->topic_date;
							echo "</div>"; 
							echo "</td>";
						echo "</tr>";
					}
				?>
			</tbody>
		</table>
	</div>
	</div>
</div>

<?php
?>